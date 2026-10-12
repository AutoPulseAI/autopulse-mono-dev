"""What the AI can't supply, answered in the client's own words (client, 12 Oct 2026 - Betsy).

    Things the AI CAN supply: an appointment date and time, a photo of the vehicle, the price of the vehicle, the
    link to the credit application, the link to the vehicle, the link to the trade appraisal estimate.
    Things the AI cannot supply: credit score, finance APR, lease or finance payment, close-up or custom video or
    photos, out-the-door price.

For each one the reply is her text, word for word, and - where she wrote "(offer 2 days/times)" - two real open
times, so the customer's pick books like any other offer (agent/nodes/decide.py records them as the visit offer).
A customer who lives out of state gets her script for that too. Code places the text (agent/nodes/compose.py
place_cannot_supply), never the model, the same way the FTC introduction is placed.

Custom photos or a video need a person: that request also puts the lead into Dealership Action Required
(agent/escalation.py). Whether an out-of-state customer does too is an open question for the client, so it doesn't
yet.
"""

import re
from dataclasses import dataclass

CREDIT_SCORE, APR, PAYMENT, OTD, CUSTOM_MEDIA, OUT_OF_STATE = (
    "credit_score", "apr", "payment", "out_the_door", "custom_media", "out_of_state")

# Checked in this order: the first match decides (a payment question that mentions the rate is a payment question).
_PATTERNS: tuple[tuple[str, str], ...] = (
    (CREDIT_SCORE, (r"\bcredit\s+score\b|\bwhat(?:'s| is)\s+my\s+(?:credit|score)\b|\bcheck\s+my\s+credit\b|"
                   r"\bpull\s+my\s+credit\b")),
    (PAYMENT, (r"\bmonthly\s+payments?\b|\bpayments?\s+(?:be|would\s+be|is|on|for)\b|\bper\s+month\b|\ba\s+month\b|"
              r"\blease\s+(?:payment|price|deal|it|for)\b|\bwhat\s+would\s+my\s+payments?\b|\bfinance\s+payment\b")),
    (APR, (r"\bapr\b|\binterest\s+rates?\b|\bwhat\s+(?:rate|rates)\b|\bfinance\s+rate\b|\brates?\s+(?:would|will|do|can)"
          r"\s+(?:i|you)\b")),
    (OTD, (r"\bout[\s-]the[\s-]door\b|\botd\b|\btotal\s+(?:price|cost)\b|\ball[\s-]in\s+(?:price|cost)\b|"
          r"\bwith\s+(?:tax|taxes)\s+and\s+fees\b")),
    (CUSTOM_MEDIA, (r"\bvideos?\b|\bwalk[\s-]?around\b|\bmore\s+(?:photos|pictures|pics)\b|\bclose[\s-]?ups?\b|"
                   r"\b(?:photos?|pictures?|pics)\s+of\s+the\s+(?:engine|tires?|wheels?|interior|seats?|trunk|"
                   r"damage|scratch\w*|dent\w*|undercarriage|back|front|inside)\b|\bsend\s+(?:me\s+)?(?:a\s+)?"
                   r"(?:video|more\s+photos|more\s+pictures)\b|\bfacetime\b|\bvideo\s+call\b")),
    (OUT_OF_STATE, (r"\bout\s+of\s+state\b|\bout-of-state\b|\b(?:another|a\s+different|different)\s+state\b|"
                   r"\bship(?:ped|ping)?\s+(?:it|the\s+(?:car|vehicle|truck)|to\s+me)\b|\bdeliver\w*\s+to\s+my\s+state\b")),
)
_COMPILED = tuple((topic, re.compile(p, re.IGNORECASE)) for topic, p in _PATTERNS)

# Betsy's words (typos corrected). {times}: "Tuesday at 10:00 AM or Wednesday at 2:00 PM".
_ASK_DAY = "What day this week works best for you to meet with us? I have {times} available."
_REPLIES: dict[str, str] = {
    CREDIT_SCORE: ("We need to meet with you in person to discuss your credit because we have to confirm your "
                   "identity. What day this week works best for you to meet with our business manager? I have {times} "
                   "available."),
    APR: ("Our goal is to get you the lowest possible APR, so this requires some work on our end. We would be doing "
          "you a disservice by quoting an automated rate. Our business manager would like to work on this for you. "
          + _ASK_DAY),
    PAYMENT: ("Our goal is to get you the lowest possible payment, so this requires some work on our end and more "
              "information about you so we can include all incentives you qualify for. We would be doing you a "
              "disservice by quoting automated information.{calculator} Our business manager would like to work on "
              "this for you. " + _ASK_DAY),
    CUSTOM_MEDIA: ("I will make sure you get some photos as soon as possible. In the meantime, if everything looks "
                   "good, when do you anticipate visiting us for a test drive? I have {times} available."),
    OTD: ("Our list price is accurate and includes the total cost to purchase the vehicle, exclusive of tax, "
          "documentation, and DMV. Is there something that concerns you that you want to ensure is included in the "
          "price? Otherwise, the next step would be to schedule a test drive. What day this week works best for you? "
          "I have {times} available."),
    OUT_OF_STATE: ("That is no problem at all; we work with customers who are out of state all the time. Do you plan "
                   "to pick the vehicle up or have it shipped to you?"),
}
_CALCULATOR = " If you are just looking for very rough figures, our payment calculator can be found here: {url}"
# With a visit already booked, the time question becomes a pointer to that visit.
_BOOKED = "We'll go over it together at your visit on {booked}."

ESCALATES = frozenset({CUSTOM_MEDIA})
ESCALATION_REASON = "Customer asked for something the AI can't supply"


@dataclass(frozen=True)
class CannotSupply:
    topic: str
    text: str
    offers_times: bool

    def as_dict(self) -> dict[str, object]:
        return {"topic": self.topic, "text": self.text, "offers_times": self.offers_times,
                "escalates": self.topic in ESCALATES}


def detect(text: str | None) -> str | None:
    said = text or ""
    return next((topic for topic, pattern in _COMPILED if pattern.search(said)), None)


def needs_times(topic: str) -> bool:
    return "{times}" in _REPLIES[topic]


def reply(topic: str, *, times: list[str] | None = None, booked: str | None = None,
          vehicle_url: str | None = None) -> CannotSupply:
    """The reply for `topic`. `times`: two open times in words; `booked`: the visit already set, in words."""
    template = _REPLIES[topic]
    calculator = _CALCULATOR.format(url=vehicle_url) if vehicle_url else ""
    template = template.replace("{calculator}", calculator)
    if "{times}" not in template:
        return CannotSupply(topic, template, False)
    if booked:
        # Drop the time question: everything up to the question that asks for a day, then the booked visit.
        cut = min(i for i in (template.find("What day"), template.find("when do you"), template.find("Otherwise"))
                  if i >= 0)
        return CannotSupply(topic, f"{template[:cut].rstrip()} {_BOOKED.format(booked=booked)}", False)
    shown = [t for t in (times or []) if t][:2]
    if len(shown) < 2:
        # No two open times: ask for their day without naming any (never invent a time).
        sentence_end = template.rfind(" I have {times} available.")
        return CannotSupply(topic, template[:sentence_end] if sentence_end >= 0 else template.replace(
            "{times}", "a time"), False)
    return CannotSupply(topic, template.replace("{times}", f"{shown[0]} or {shown[1]}"), True)
