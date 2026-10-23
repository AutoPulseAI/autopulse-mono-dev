"""Text from lead portals that is not the customer's."""

import re

# Portal boilerplate in a lead's comments (client, 18 Oct 2026: a first text said "For notification changes, please
# contact support@cars.com") - never the customer's words.
_PORTAL_BOILERPLATE = re.compile(
    r"notification|unsubscribe|opt[- ]out|privacy|terms of use|do not reply|support@|no-?reply@|"
    r"this (?:lead|email|message) was (?:sent|generated)|powered by|view (?:this )?lead in|"
    # Client, 20 Oct 2026 (JJ: the first text said "That 'Initial Referring URL' line is just a form field"): form
    # fields and tracking data a portal adds to the comments.
    r"referr(?:ing|er|al)\s*(?:url|page|site)|landing\s*page|initial\s*(?:url|page)|utm_|gclid|fbclid|"
    r"\b(?:lead\s*(?:id|source|type)|source\s*(?:id|url)|campaign|ip\s*address|user\s*agent)\s*[:=]|"
    # Live, 23 Oct 2026 (a CarGurus repeat lead got "Those CarGurus alerts just mean you viewed that vehicle"): the
    # portals' own labels and alerts.
    r"shopper\s*signals|cargur\.us|placed\s*deposit|phone\s*lead\s*from|shopper\s*alert|"
    r"this\s*person\s*is\s*still\s*active|you\s*have\s*a\s*new\s*lead|new\s*inquiry\s*submitted|"
    r"before\s*you\s*reach\s*out|click\s*the\s*link|(?:deal\s*rating|price\s*analysis|imv)\s*[:=]",
    re.IGNORECASE)


def clean_comments(text: str | None) -> str:
    """The comments without a portal's own sentences."""
    sentences = re.split(r"(?<=[.!?])\s+|\n+|\s*\|\s*", str(text or ""))
    return " ".join(s.strip() for s in sentences if s.strip() and not _PORTAL_BOILERPLATE.search(s)).strip()
