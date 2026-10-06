"""Reply templates (architecture §4, MASTER_PLAN_1 Stage 4).

One per lead type, each with an SMS version and an email version. They are
the first reply until the AI pipeline is real (Stage 8), and after that the
permanent safety net: a turn that runs out of time or fails its guard twice
sends one of these instead of nothing.

Templates contain no numbers, prices or promises, so they can never break
the never-invent rule. They ask one question, matching the first slot the
lead type needs.
"""

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
TEMPLATE_PROMISE = "A member of the team will follow up shortly."

# MASTER_PLAN_3 Phase 5: sent only when a mentioned vehicle sold and, despite
# the instruction to always write one, Compose left no stock-free version to
# fall back to. Never the vehicle's own name-naming text - the whole point of
# this text is to guarantee a sold vehicle is never sent, even in that gap.
# PLAN_4 stream X2 (Sales Lead Blueprint box 4, "POSITIVE OUTCOMES ONLY - never say a vehicle is not available"):
# leads with the next step and the alternatives, never a flat "not available"; and claims no stock it hasn't checked.
SOLD_VEHICLE_FALLBACK_TEXT = ("Thanks for your patience! The team is lining up a few similar options for you. "
                              "When would be a good time to take a look?")
SOLD_VEHICLE_FALLBACK_SUBJECT = "Update on your inquiry"


_SIGN_OFF = "\n\nThanks,\nThe {team} Team"

FIRST_REPLY: dict[LeadType, Template] = {
    LeadType.SALES: Template(
        sms=(
            "Hi {name}, thanks for reaching out! We got your inquiry, and our sales team will follow up "
            "shortly. Are you looking for a new or a used vehicle?"
        ),
        email_subject="Thanks for your inquiry",
        email_body=(
            "Hi {name},\n\nThanks for reaching out! We received your inquiry, and a member of our sales team "
            "will follow up shortly.\n\nSo we can pull together the right options, are you looking for a new or "
            "a used vehicle, and do you have a timeline in mind?" + _SIGN_OFF.format(team="Sales")
        ),
        sms_asks=("interest.new_or_used",),
        email_asks=("interest.new_or_used", "interest.timeline"),
    ),
    LeadType.TRADE_IN: Template(
        sms=(
            "Hi {name}, thanks for reaching out about your trade-in! Our team will follow up shortly. "
            "What year, make and model is it, and about how many miles?"
        ),
        email_subject="About your trade-in",
        email_body=(
            "Hi {name},\n\nThanks for reaching out about your trade-in! A member of our team will follow up "
            "shortly.\n\nTo get started: what year, make and model is your vehicle, and roughly how many "
            "miles are on it?" + _SIGN_OFF.format(team="Trade-in")
        ),
        sms_asks=("trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage"),
        email_asks=("trade_in.year", "trade_in.make", "trade_in.model", "trade_in.mileage"),
    ),
    LeadType.SERVICE: Template(
        sms=(
            "Hi {name}, thanks for contacting our service team! We'll follow up shortly. "
            "Which vehicle is this for, and what day works best for you?"
        ),
        email_subject="Your service request",
        email_body=(
            "Hi {name},\n\nThanks for contacting our service team! We'll follow up shortly to get you "
            "scheduled.\n\nWhich vehicle is this for (year, make and model), and what day works best for "
            "you?" + _SIGN_OFF.format(team="Service")
        ),
        sms_asks=("vehicle.year", "vehicle.make", "vehicle.model"),
        email_asks=("vehicle.year", "vehicle.make", "vehicle.model"),
    ),
    LeadType.GENERAL: Template(
        sms=(
            "Hi {name}, thanks for reaching out! Someone from our team will follow up shortly. "
            "Are you shopping for a vehicle, trading one in, or booking service?"
        ),
        email_subject="Thanks for reaching out",
        email_body=(
            "Hi {name},\n\nThanks for reaching out! Someone from our team will follow up shortly.\n\n"
            "So we can point you to the right person: are you shopping for a vehicle, trading one in, or "
            "booking service?" + _SIGN_OFF.format(team="Customer Care")
        ),
        sms_asks=("interest.lead_type",),
        email_asks=("interest.lead_type",),
    ),
}


def first_name(full_name: str | None) -> str:
    """First word of the customer's name, title-cased and capped in length, or
    a neutral greeting when there's nothing usable (e.g. an SMS-only lead
    whose name the platform never learned)."""
    if not full_name:
        return FALLBACK_NAME
    first = str(full_name).strip().split()[0] if str(full_name).strip() else ""
    first = "".join(ch for ch in first if ch.isalpha() or ch in "-'")
    if not first:
        return FALLBACK_NAME
    return first[:FIRST_NAME_MAX_CHARS].capitalize()


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
        "promises": [TEMPLATE_PROMISE],
    }


# PLAN_4 stream Q: the safety net mid-conversation. The first-reply template ("Are you looking for a new or a used
# vehicle?") ignored the conversation (seen: sent right after the customer said "used"). This one only thanks
# them, takes any open question to the team, or asks the next detail Decide chose - a detail still missing, so
# never one they just gave. Still no numbers, prices or promises beyond the team following up.
CONTINUE_CHECKING = "Thanks, {name}. Let me check on that with the team, and someone will get back to you shortly."
CONTINUE_NOTED = "Thanks, {name}. I've made a note of that."
CONTINUE_ASK = "Thanks, {name}. {question}"
# The same for a customer who writes in Spanish (agent/language.py). The asks' wording is English-only, so a
# Spanish fallback never asks: it notes their message, or takes the question to the team.
CONTINUE_CHECKING_ES = "Gracias, {name}. Voy a consultarlo con el equipo, y alguien le responderá muy pronto."
CONTINUE_NOTED_ES = "Gracias, {name}. Ya tomé nota."
FIRST_REPLY_ES = "Hola {name}, gracias por comunicarse con nosotros. Un miembro de nuestro equipo le responderá muy pronto."
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
        line = f"Good morning, {name}! The team is in now."
    elif mode == "later":
        line = f"Thanks, {name}! The team will pick this up when we open" + (f" at {opens_at}" if opens_at else "") + "."
    else:
        return None
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
                "promises": [TEMPLATE_PROMISE] if decision.get("answer_questions") else []}
    if decision.get("answer_questions"):
        line, asked = CONTINUE_CHECKING.format(name=name), []
        promises = [TEMPLATE_PROMISE]
    elif asks:
        line, asked = CONTINUE_ASK.format(name=name, question=asks[0]["question"]), list(asks[0].get("slots") or [])
    else:
        line, asked = CONTINUE_NOTED.format(name=name), []
    body = f"Hi {name},\n\n{line.split('. ', 1)[1] if '. ' in line else line}" + _SIGN_OFF.format(team="Customer Care")
    return {
        "sms_text": line,
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
        sms="Thanks, {name}! I've passed this to the team, and someone will reach out shortly.",
        email_subject="We've got your message",
        email_body=(
            "Hi {name},\n\nThanks for your message. I've passed it to the team, and someone will reach out "
            "shortly." + _SIGN_OFF.format(team="Customer Care")
        ),
    ),
    # PLAN_4 stream X3 item 4: the customer asked to book while a person owns the lead.
    "holding_booking": Template(
        sms="Thanks, {name}! I've passed your request to come in to the team, and someone will confirm the time "
            "with you shortly.",
        email_subject="We've got your request",
        email_body=(
            "Hi {name},\n\nThanks for your message. I've passed your request to come in to the team, and someone "
            "will confirm the time with you shortly." + _SIGN_OFF.format(team="Customer Care")
        ),
    ),
    "still_waiting": Template(
        sms="Sorry for the wait, {name}. The team has your messages and will get back to you as soon as they can.",
        email_subject="Still on it",
        email_body=(
            "Hi {name},\n\nSorry for the wait. The team has your messages and will get back to you as soon as "
            "they can." + _SIGN_OFF.format(team="Customer Care")
        ),
    ),
}
HOLDING_PROMISE = "A member of the team will reach out shortly."


def render_holding_reply(kind: str, full_name: str | None) -> dict[str, Any]:
    template = HOLDING_REPLIES[kind]
    name = first_name(full_name)
    return {
        "sms_text": template.sms.format(name=name),
        "email_subject": template.email_subject,
        "email_body": template.email_body.format(name=name),
        "template": kind,
        "asks": {"sms": [], "email": []},
        "promises": [HOLDING_PROMISE],
    }
