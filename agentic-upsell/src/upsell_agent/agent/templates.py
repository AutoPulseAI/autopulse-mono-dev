"""Reply templates (architecture §4, MASTER_PLAN_1 Stage 4).

One per lead type, each with an SMS version and an email version. They are
the first reply until the AI pipeline is real (Stage 8), and after that the
permanent safety net: a turn that runs out of time or fails its guard twice
sends one of these instead of nothing.

Templates contain no numbers, prices or promises, so they can never break
the never-invent rule. They ask one question, matching the first slot the
lead type needs.
"""

import re
from dataclasses import dataclass
from typing import Any

from upsell_agent.agent.qualification import LeadType

# Two SMS segments (architecture §7). Every template must fit with the longest
# allowed first name; tests/unit/test_templates.py checks it.
SMS_MAX_CHARS = 320
FIRST_NAME_MAX_CHARS = 30
FALLBACK_NAME = "there"


@dataclass(frozen=True)
class Template:
    sms: str
    email_subject: str
    email_body: str
    # The slots each version asks for, so the conversation state records what
    # a template reply asked (agent/conversation.py).
    sms_asks: tuple[str, ...] = ()
    email_asks: tuple[str, ...] = ()


# What every template tells the customer the team will do.
TEMPLATE_PROMISE = "Our sales manager will follow up shortly."

# MASTER_PLAN_3 Phase 5: sent only when a mentioned vehicle sold and, despite
# the instruction to always write one, Compose left no stock-free version to
# fall back to. Never the vehicle's own name-naming text - the whole point of
# this text is to guarantee a sold vehicle is never sent, even in that gap.
# PLAN_4 stream X2 (Sales Lead Blueprint box 4, "POSITIVE OUTCOMES ONLY - never say a vehicle is not available"):
# leads with the next step and the alternatives, never a flat "not available"; and claims no stock it hasn't checked.
SOLD_VEHICLE_FALLBACK_TEXT = ("Thanks for your patience! I have a few similar options I'd love to show you. "
                              "What day this week works best for you to take a look?")
SOLD_VEHICLE_FALLBACK_SUBJECT = "Update on your inquiry"


# Client, 12 Oct 2026: the AI speaks for itself, never "the team" - so no "The Sales Team" signature either.
_SIGN_OFF = "\n\nThank you"

FIRST_REPLY: dict[LeadType, Template] = {
    LeadType.SALES: Template(
        sms=(
            "Hi {name}, thanks for reaching out! Are you looking for a new or a used vehicle?"
        ),
        email_subject="Thanks for your inquiry",
        email_body=(
            "Hi {name},\n\nThanks for reaching out! So I can pull together the right options, are you looking for "
            "a new or a used vehicle, and do you have a timeline in mind?" + _SIGN_OFF.format(team="Sales")
        ),
        sms_asks=("interest.new_or_used",),
        email_asks=("interest.new_or_used", "interest.timeline"),
    ),
    LeadType.TRADE_IN: Template(
        sms=(
            "Hi {name}, thanks for reaching out about your trade-in! What year, make and model is it, and about "
            "how many miles?"
        ),
        email_subject="About your trade-in",
        email_body=(
            "Hi {name},\n\nThanks for reaching out about your trade-in! To get started: what year, make and model "
            "is your vehicle, and roughly how many miles are on it?" + _SIGN_OFF.format(team="Trade-in")
        ),
        sms_asks=("trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage"),
        email_asks=("trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage"),
    ),
    LeadType.SERVICE: Template(
        sms=(
            "Hi {name}, thanks for contacting our service department! Which vehicle is this for, and what day "
            "works best for you?"
        ),
        email_subject="Your service request",
        email_body=(
            "Hi {name},\n\nThanks for contacting our service department! Which vehicle is this for (year, make "
            "and model), and what day works best for you?" + _SIGN_OFF.format(team="Service")
        ),
        sms_asks=("vehicle.year", "vehicle.make", "vehicle.model"),
        email_asks=("vehicle.year", "vehicle.make", "vehicle.model"),
    ),
    LeadType.GENERAL: Template(
        sms=(
            "Hi {name}, thanks for reaching out! Are you shopping for a vehicle, trading one in, or booking "
            "service?"
        ),
        email_subject="Thanks for reaching out",
        email_body=(
            "Hi {name},\n\nThanks for reaching out! Are you shopping for a vehicle, trading one in, or booking "
            "service?" + _SIGN_OFF.format(team="Customer Care")
        ),
        sms_asks=("interest.lead_type",),
        email_asks=("interest.lead_type",),
    ),
}


def first_name(full_name: str | None) -> str:
    """First word of the customer's name, title-cased and capped in length, or
    a neutral greeting when there's nothing usable (e.g. an SMS-only lead
    whose name the platform never learned)."""
    return known_first_name(full_name) or FALLBACK_NAME


# Client, 12 Oct 2026 (Betsy: "Hello again, Null" and "Sorry for the wait, Name" went to customers): what portals and
# forms put in the name field when there is no name. Never a name.
NOT_A_NAME = frozenset({"null", "none", "nil", "undefined", "name", "names", "first", "firstname", "last",
                        "lastname", "fullname", "customer", "client", "guest", "lead", "unknown", "na", "n/a", "nobody",
                        "noname", "test", "there", "sir", "madam", "mr", "mrs", "ms"})


def known_first_name(full_name: str | None) -> str | None:
    """The customer's real first name, or None when the record has none (empty, "null null", "Name", an email or a
    number) - then the AI greets without a name and asks for it."""
    text = str(full_name or "").strip()
    if not text or "@" in text:
        return None
    for word in text.replace(",", " ").split():
        first = "".join(ch for ch in word if ch.isalpha() or ch in "-'")
        if first and first.lower().strip("-'") not in NOT_A_NAME and len(first) > 1:
            return first[:FIRST_NAME_MAX_CHARS].capitalize()
        if first.lower() not in NOT_A_NAME:
            break
    return None


def render_first_reply(lead_type: LeadType | None, full_name: str | None) -> dict[str, str]:
    """Both channel versions of the template for this lead type. Both are
    always produced, because the 24-hour channel switch (Stage 10) re-sends
    the same message on the other channel without another AI call."""
    template = FIRST_REPLY[lead_type or LeadType.GENERAL]
    name = first_name(full_name)
    return {
        "sms_text": template.sms.format(name=name),
        "email_subject": template.email_subject,
        "email_body": template.email_body.format(name=name),
        "template": (lead_type or LeadType.GENERAL).value,
        "asks": {"sms": list(template.sms_asks), "email": list(template.email_asks)},
        "promises": [],
    }


# PLAN_4 stream Q: the safety net mid-conversation. The first-reply template ("Are you looking for a new or a used
# vehicle?") ignored the conversation (seen: sent right after the customer said "used"). This one only thanks
# them, takes any open question to the team, or asks the next detail Decide chose - a detail still missing, so
# never one they just gave. Still no numbers, prices or promises beyond the team following up.
CONTINUE_CHECKING = ("Thanks, {name}. That's something we can go over together when you come in. What day this week "
                     "works best for you?")
CONTINUE_NOTED = "Thanks, {name}. I've made a note of that."
# Client, 12 Oct 2026 (Jean got "Let me check on that with the team" twice in a row): the safety net never sends the
# same words again - the next unused one of these instead (agent/nodes/template_reply.py avoid_repeat).
CONTINUE_VARIANTS = [
    "Got it, {name}. We can cover that in person. Would a weekday or the weekend work better for you to come in?",
    "Thank you, {name}. I've made a note of that. When would be a good time for you to stop by?",
    "Thanks, {name}. Is there anything else I can help you with before your visit?",
]
CONTINUE_ASK = "Thanks, {name}. {question}"
# The same for a customer who writes in Spanish (agent/language.py). The asks' wording is English-only, so a
# Spanish fallback never asks: it notes their message, or takes the question to the team.
CONTINUE_CHECKING_ES = "Gracias, {name}. Podemos verlo juntos cuando nos visite. ¿Qué día de esta semana le conviene?"
CONTINUE_NOTED_ES = "Gracias, {name}. Ya tomé nota."
FIRST_REPLY_ES = "Hola {name}, gracias por comunicarse con nosotros. ¿En qué le puedo ayudar hoy?"
_SIGN_OFF_ES = "\n\nGracias,\nEl equipo de atención al cliente"


def _upper_first(text: str) -> str:
    return text[:1].upper() + text[1:]


# "resume" / "later" (MASTER_PLAN_3 B1): the one thing each must say, guaranteed - even the AI's rewrite can
# drop it (seen live, 6 Oct 2026, gpt-5-mini: "tomorrow is fine" got "I won't keep asking", and the next
# morning got a budget question with no acknowledgment it was morning at all). Same reasoning as Touch 1's
# intro and the name nudge: this exact fact is too important to leave to a second model call that already
# failed once (agent/nodes/guard.py's missing_resume_acknowledgment / missing_later_acknowledgment check for
# it; this is what the customer gets if both of the AI's own attempts still missed it).
def _after_hours_fallback(name: str, after_hours: dict[str, Any]) -> dict[str, Any] | None:
    mode, opens_at = after_hours.get("mode"), after_hours.get("opens_at")
    if mode == "resume":
        line = f"Good morning, {name}! We're open now. What day this week works best for you to come in?"
    elif mode == "later":
        line = f"Thanks, {name}! I'll pick this up when we open" + (f" at {opens_at}" if opens_at else "") + "."
    else:
        return None
    from upsell_agent import ai_studio  # the wording published in AI Studio, when edited there
    edited = ai_studio.fixed_text(ai_studio.message("messages", f"after_hours_{mode}"))
    if edited:
        line = ai_studio.fill(edited, {"first_name": name, "opens_at": opens_at})
    body_line = line.split("! ", 1)[1] if "! " in line else line
    return {"sms_text": line, "email_subject": "Following up",
            "email_body": f"Hi {name},\n\n{body_line}" + _SIGN_OFF.format(team="Customer Care"),
            "template": "continue", "asks": {"sms": [], "email": []}, "promises": []}


def render_continue_reply(full_name: str | None, decision: dict[str, Any] | None, *,
                          first: bool = False) -> dict[str, Any]:
    """The template for a reply after the first one (agent/nodes/template_reply.py), from Decide's own plan."""
    decision = decision or {}
    name = first_name(full_name)
    asks = [a for a in decision.get("asks") or [] if a.get("question")][:1]
    promises: list[str] = []
    if decision.get("reply_language") != "Spanish" and (
            ack := _after_hours_fallback(name, decision.get("after_hours") or {})):
        return ack
    if decision.get("reply_language") == "Spanish":
        line = (FIRST_REPLY_ES if first else CONTINUE_CHECKING_ES if decision.get("answer_questions")
                else CONTINUE_NOTED_ES).format(name=name)
        return {"sms_text": line, "email_subject": "Seguimiento",
                "email_body": f"Hola {name},\n\n{_upper_first(line.split(', ' if first else '. ', 1)[1])}" + _SIGN_OFF_ES, "template": "continue",
                "asks": {"sms": [], "email": []},
                "promises": []}
    if decision.get("answer_questions"):
        from upsell_agent import ai_studio  # the wording published in AI Studio, when edited there
        edited = ai_studio.fixed_text(ai_studio.message("messages", "safety_net"))
        line, asked = (ai_studio.fill(edited, {"first_name": name}) if edited
                       else CONTINUE_CHECKING.format(name=name)), []
        promises = []
    elif asks:
        line, asked = CONTINUE_ASK.format(name=name, question=asks[0]["question"]), list(asks[0].get("slots") or [])
    else:
        line, asked = CONTINUE_NOTED.format(name=name), []
    body = f"Hi {name},\n\n{line.split('. ', 1)[1] if '. ' in line else line}" + _SIGN_OFF.format(team="Customer Care")
    return {
        "sms_text": without_missing_name(line),
        "email_subject": "Following up",
        "email_body": body,
        "template": "continue",
        "asks": {"sms": asked, "email": asked},
        "promises": promises,
    }


# While a person owns the lead (architecture §15, decision 12). "holding": the
# customer wrote while the lead is handed off. "still_waiting": the handoff
# timeout fired and staff haven't taken the lead over yet.
HOLDING_REPLIES: dict[str, Template] = {
    "holding": Template(
        sms="Thanks, {name}! I've passed this to our sales manager, who will reach out to you shortly.",
        email_subject="We've got your message",
        email_body=(
            "Hi {name},\n\nThanks for your message. I've passed it to our sales manager, who will reach out to "
            "you shortly." + _SIGN_OFF.format(team="Customer Care")
        ),
    ),
    # PLAN_4 stream X3 item 4: the customer asked to book while a person owns the lead.
    "holding_booking": Template(
        sms="Thanks, {name}! I've passed your request to come in to our sales manager, who will confirm the time "
            "with you shortly.",
        email_subject="We've got your request",
        email_body=(
            "Hi {name},\n\nThanks for your message. I've passed your request to come in to our sales manager, who "
            "will confirm the time with you shortly." + _SIGN_OFF.format(team="Customer Care")
        ),
    ),
    "still_waiting": Template(
        sms="Sorry for the wait, {name}. Our sales manager has your messages and will get back to you as soon as "
            "possible.",
        email_subject="Still on it",
        email_body=(
            "Hi {name},\n\nSorry for the wait. Our sales manager has your messages and will get back to you as "
            "soon as possible." + _SIGN_OFF.format(team="Customer Care")
        ),
    ),
}
HOLDING_PROMISE = "Our sales manager will reach out shortly."


def without_missing_name(text: str) -> str:
    """With no real name (known_first_name is None), ", there" in a sentence reads oddly ("Sorry for the wait,
    there."): drop it. "Hi there," stays."""
    return re.sub(r",\s+there(?=[.!?])", "", text)


def render_holding_reply(kind: str, full_name: str | None) -> dict[str, Any]:
    template = HOLDING_REPLIES[kind]
    name = first_name(full_name)
    return {
        "sms_text": without_missing_name(template.sms.format(name=name)),
        "email_subject": template.email_subject,
        "email_body": without_missing_name(template.email_body.format(name=name)),
        "template": kind,
        "asks": {"sms": [], "email": []},
        "promises": [HOLDING_PROMISE],
    }
