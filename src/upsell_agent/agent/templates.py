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
SOLD_VEHICLE_FALLBACK_TEXT = "Sorry for the wait - that one's no longer available, but the team can find you another option."
SOLD_VEHICLE_FALLBACK_SUBJECT = "Update on your inquiry"


_SIGN_OFF = "\n\nThanks,\nThe {team} Team"

FIRST_REPLY: dict[LeadType, Template] = {
    LeadType.SALES: Template(
        sms=(
            "Hi {name}, thanks for reaching out! We got your inquiry and our sales team will follow up "
            "shortly. Are you looking at new or used?"
        ),
        email_subject="Thanks for your inquiry",
        email_body=(
            "Hi {name},\n\nThanks for reaching out! We received your inquiry and a member of our sales team "
            "will follow up shortly.\n\nSo we can pull together the right options: are you looking at new or "
            "used, and do you have a timeline in mind?" + _SIGN_OFF.format(team="Sales")
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


# While a person owns the lead (architecture §15, decision 12). "holding": the
# customer wrote while the lead is handed off. "still_waiting": the handoff
# timeout fired and staff haven't taken the lead over yet.
HOLDING_REPLIES: dict[str, Template] = {
    "holding": Template(
        sms="Thanks, {name}! I've passed this to the team and someone will reach out shortly.",
        email_subject="We've got your message",
        email_body=(
            "Hi {name},\n\nThanks for your message. I've passed it to the team, and someone will reach out "
            "shortly." + _SIGN_OFF.format(team="Customer Care")
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
