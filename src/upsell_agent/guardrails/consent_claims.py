"""The AI never states or infers consent or eligibility (PLAN_4 stream X1 item 9, TCPA PDF §10): "AI may never state
or infer that a customer consented, has an established business relationship, is eligible, is not suppressed or
is legally contactable". Compose is told so (agent/llm.py COMPOSE_INSTRUCTIONS); this is the code check behind it,
run on every draft by guardrails/draft_guard.py. Plain patterns, same answer every time."""

import re

_PATTERNS = [
    # "you opted in", "since you signed up for texts", "you've subscribed"
    r"\byou(?:'ve|\s+have)?\s+(?:already\s+)?(?:opted|signed)[\s-]*(?:in|up)\b",
    r"\byou(?:'re|\s+are)\s+(?:opted[\s-]*in|subscribed|signed\s+up)\b",
    r"\byou(?:'ve|\s+have)?\s+(?:already\s+)?subscribed\b",
    # "you consented / agreed to receive texts", "you gave us permission"
    r"\byou(?:'ve|\s+have)?\s+(?:already\s+)?(?:consented|agreed|authori[sz]ed)\s+(?:to\s+(?:receive|get|be)|us)\b",
    r"\byou\s+(?:gave|have\s+given|provided)\s+(?:us\s+)?(?:your\s+)?(?:permission|consent)\b",
    r"\b(?:per|under|with|because\s+of|thanks\s+to|based\s+on)\s+your\s+(?:consent|opt[\s-]*in|permission)\b",
    # "you're eligible", "you qualify", "you're cleared to be contacted"
    r"\byou(?:'re|\s+are)\s+(?:now\s+)?(?:eligible|cleared|pre[\s-]*qualified|approved\s+to\s+receive)\b",
    r"\byou\s+qualify\s+(?:for|to)\b",
    # "you're not on any do-not-call list", "you aren't suppressed"
    (r"\byou(?:'re|\s+are)\s+not\s+(?:on\s+(?:any|the|our|a)\s+)?(?:do[\s-]*not[\s-]*(?:call|contact|text)|dnc|"
     r"suppression|opt[\s-]*out)\b"),
    r"\byou\s+(?:aren't|are\s+not|weren't)\s+(?:suppressed|opted\s+out|blocked)\b",
    # "we're allowed / legally able to text you", "we have your permission"
    (r"\bwe(?:'re|\s+are)\s+(?:allowed|permitted|legally\s+(?:able|allowed|permitted)|cleared)\s+to\s+"
     r"(?:text|call|contact|message|email|reach)\b"),
    r"\bwe\s+have\s+your\s+(?:permission|consent|opt[\s-]*in)\b",
    r"\b(?:existing|established)\s+(?:(?:business|customer)\s+)?relationship\b",
]
_COMPILED = [re.compile(p, re.IGNORECASE) for p in _PATTERNS]


def consent_claims(text: str) -> list[str]:
    """The phrases in `text` that state or infer the customer's consent, eligibility or contactability."""
    norm = (text or "").replace("’", "'")
    return [m.group(0) for p in _COMPILED if (m := p.search(norm))]
