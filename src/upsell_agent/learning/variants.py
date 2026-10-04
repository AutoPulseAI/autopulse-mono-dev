"""What the A/B tests vary (PLAN_4 stream L item 3; blueprint box 5:
"Continuously A/B test wording, timing, and strategies").

**Wording:** 2-3 phrasings of the instruction Compose gets for each cadence
theme. They are different ways of approaching the same theme, never a change
to the client's mandated text: Touch 1's opening and closing and Touch 2's
"{FirstName}?" have no variants, and every phrasing keeps the theme's own
never-invent rules. Variant "a" is the theme's original instruction
(agent/cadence.py), so a dealer with no test data still gets today's wording
half the time.

**Send time:** a Day 2-90 touch goes out in the morning (10:00, the original
hour) or the afternoon (15:00), dealer-local. Either way the send check still
holds it to the dealer's opening hours and the customer's own window, so a
variant never moves a message outside them.
"""

from upsell_agent.agent import cadence

_NEVER_PRICE = "Never state a rate, a term, a payment, a price or an approval - the team confirms all of that."

WORDING: dict[str, dict[str, str]] = {
    "vehicle_visual": {
        "b": ("Lead with the vehicle itself: one thing from its inventory record they'd notice in person (color, "
              "trim), then ask whether they'd like to see it. Use only what the inventory records say."),
        "c": ("Ask a single easy either/or question about the vehicle they asked about (this one or something "
              "similar? see it this week or next?). Use only what the inventory records say."),
    },
    "financing_help": {
        "b": ("Offer, in one friendly line, to have the team put together their payment options so they don't "
              "have to work it out alone, and ask if that would help. " + _NEVER_PRICE),
        "c": ("Ask whether they've thought about how they'd like to pay - finance, lease or cash - and offer the "
              "team's help with whichever they prefer. " + _NEVER_PRICE),
    },
    "trade_in": {
        "b": ("Mention that many people put their current vehicle towards the new one, and ask whether they'd "
              "like theirs looked at (by name if we know it). Never a value or an estimate."),
        "c": ("Ask one short question about their current vehicle (what it is, or roughly how many miles) so the "
              "team can look at it for them. Never a value or an estimate."),
    },
    "vehicle_value": {
        "b": ("Connect one verified fact from the inventory record to something they told us they care about, "
              "in one sentence, then ask a light question. Nothing invented."),
        "c": ("Pick the single most useful verified detail about the vehicle (from the inventory record) and "
              "ask whether it matters to them. Nothing invented."),
    },
    "appointment_value": {
        "b": ("Say what they'd get done in one short visit that fits their situation (see it, an appraisal, a "
              "financing review) and ask which day works."),
        "c": ("Keep it light: offer a quick, no-pressure look in person, and ask whether a weekday or the "
              "weekend suits them better."),
    },
    "direct_close": {
        "b": ("Ask plainly whether they're still in the market, and make it easy to say yes or no - offer to "
              "hold a time if they are."),
        "c": ("Ask whether anything is holding them back from coming in, and offer to set a time that suits "
              "them."),
    },
    "price_or_offer": {
        "b": ("Only if the inventory record for their vehicle shows a verified price change, lead with it in "
              "one plain sentence. If there is none, ask whether they'd like to hear when something that fits "
              "them comes in - never invent a price, a discount or an offer."),
    },
}

# Send-time variants for a Day 2-90 touch: dealer-local hour. "morning" is the original TOUCH_HOUR.
SEND_TIMES: dict[str, int] = {"morning": cadence.TOUCH_HOUR, "afternoon": 15}
SEND_TIME_LABELS = {"morning": "Morning send (10:00)", "afternoon": "Afternoon send (15:00)"}


def wording_options(theme_id: str | None) -> list[str]:
    """The variant ids for a theme ("a" is its original instruction). None / the name nudge: no test."""
    if not theme_id or theme_id == cadence.NAME_NUDGE.id or theme_id not in cadence.BY_ID:
        return []
    return ["a", *WORDING.get(theme_id, {})]


def instruction(theme_id: str, variant: str | None) -> str:
    """The instruction Compose gets for this theme and variant."""
    base = cadence.BY_ID[theme_id].instruction
    if not variant or variant == "a":
        return base
    return WORDING.get(theme_id, {}).get(variant, base)


def variant_label(theme_id: str | None, variant: str | None) -> str:
    """Plain words for the report: "Financing help - wording B"."""
    theme = cadence.BY_ID.get(theme_id or "")
    name = theme.label if theme else (theme_id or "Other")
    return f"{name} - wording {str(variant or 'a').upper()}"
