"""The AI stuck in a loop, and what a message after an escalation is about (the user and Betsy, 2-3 Nov 2026).

Kenneth Ball, 2 Nov 2026: "Can u send me the website of the SUV" - "Which SUV would you like the link for?" - "Yes" -
visit times - "So I can see the SUV Cadillac all around" - "Which SUV model would you like the link for?" - "Yes" -
visit times again. April Carman: "27,000 with everything included" answered "I can't confirm that total here" five
times until "Forget it, I'm not driving over an hour to be told I can't buy it today". Betsy: "if it goes into a loop
it needs to escalate". The user: "whenever AI is stuck in a loop it must escalate that case to the manager".

`loop_reason()` - pure code, no model - is why this reply would go round again, or None:
- the customer says we're going in circles ("I already told you", "you're not listening", "???");
- our last two replies asked the same question and the customer is answering a third time;
- the customer asked about the same thing three messages running, with our replies in between.

`same_topic()` (Betsy: "if it's something new, answer it; if it's the question we escalated for, don't"): whether a
message after an escalation is about what the lead was escalated for. A question about anything else is new.
"""

import re
from typing import Any

# AI Studio, Conversation rules: "AI stuck in a loop goes to a manager" (ai_studio.py).
ESCALATE_ON_LOOP = True

_CIRCLES = re.compile(
    r"\b(?:i(?:'ve| have)? already (?:told|said|asked|answered|gave|sent)|i just (?:told|said|asked)|"
    r"(?:you'?re|you are) not (?:listening|reading|understanding)|same (?:question|thing) (?:again|over)|"
    r"going (?:in|round in|around in) circles|answer (?:my|the) (?:question|q)|stop asking (?:me )?(?:the same|that|this)|"
    r"(?:read|look at) (?:my|the) (?:last |previous )?(?:message|text)|how many times)\b"
    r"|\?{3,}", re.IGNORECASE)

# What a message is about, for comparing messages (not for answering them).
TOPICS: dict[str, re.Pattern[str]] = {
    "price": re.compile(r"\b(?:price|priced|cost|how much|out the door|otd|offer|deal|discount|lowest|best price|"
                        r"walk ?away|total|all in|tax(?:es)?|fees?|negotiat\w*|\$\s?\d|\d{1,3}(?:,\d{3}|k)\b)", re.I),
    "payment": re.compile(r"\b(?:monthly|per month|a month|/mo|payments?|down ?payment|put down|apr|interest|rate|"
                          r"financ\w*|loan|lease|credit|approv\w*)\b", re.I),
    "trade": re.compile(r"\b(?:trade|trade-?in|appraisal|my (?:car|truck|vehicle)|payoff|owe)\b", re.I),
    "media": re.compile(r"\b(?:link|website|site|url|pictures?|pics?|photos?|images?|video|walk ?around|all around|"
                        r"see it|look at it|every angle)\b", re.I),
    "availability": re.compile(r"\b(?:available|still (?:there|have|for sale)|in stock|sold|on the lot)\b", re.I),
    "condition": re.compile(r"\b(?:condition|mileage|miles|accident|carfax|history|damage|issues?|problems?|"
                            r"warranty|inspection|tires?|brakes?)\b", re.I),
    "hours": re.compile(r"\b(?:open|close[sd]?|hours|sunday|saturday|weekend|holiday)\b", re.I),
    "location": re.compile(r"\b(?:address|location|where are you|directions|located|how far)\b", re.I),
    "delivery": re.compile(r"\b(?:deliver\w*|ship\w*|out of state|pick ?up|transport)\b", re.I),
    "person": re.compile(r"\b(?:person|human|manager|someone|somebody|real (?:person|people)|call me|text me|"
                         r"salesman|sales ?person|rep)\b", re.I),
    "other_vehicle": re.compile(r"\b(?:other (?:cars?|vehicles?|options|ones?)|anything else|similar|"
                                r"different (?:car|model|color|colour)|something (?:else|cheaper|newer))\b", re.I),
}

_WORD = re.compile(r"[^\W_]+", re.UNICODE)
# A visit offer with its times ("today at 2:00 PM, 3:00 PM or 4:00 PM?"): re-offering is by design, not a loop.
_OFFER = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|"
                    r"friday|saturday|sunday)\s+(?:at|morning|afternoon|evening)\b", re.IGNORECASE)


def _nothing_new(text: str) -> bool:
    """A short answer that gives nothing new: "Yes", "ok", "?", "the SUV" - no number, at most three words."""
    return len(_WORD.findall(text)) <= 3 and not re.search(r"\d", text)


def topics(text: str | None) -> set[str]:
    return {name for name, pattern in TOPICS.items() if pattern.search(text or "")}


def _question(text: str) -> str:
    """The last question in a message, as plain lowercase words."""
    parts = re.findall(r"[^.?!。？！]*[?？]", text or "")
    return " ".join(_WORD.findall(parts[-1].lower())) if parts else ""


def _similar(a: str, b: str) -> bool:
    wa, wb = set(a.split()), set(b.split())
    if not wa or not wb:
        return False
    return len(wa & wb) / len(wa | wb) >= 0.6


def _messages(memory: list[Any] | None) -> list[tuple[str, str]]:
    out = []
    for m in memory or []:
        get = m.get if isinstance(m, dict) else (lambda k, _m=m: getattr(_m, k, None))
        if get("direction") in ("inbound", "outbound") and get("source") != "lead_form":
            # Only our own replies count as "we asked": a staff member's text is not the AI going round.
            if get("direction") == "outbound" and get("author") not in (None, "ai"):
                continue
            out.append((get("direction"), str(get("text") or "")))
    return out


def loop_reason(text: str | None, memory: list[Any] | None) -> str | None:
    """Why the next reply would go round again (see the module doc), or None. `memory`: the conversation before
    this message, oldest first (the context pack's working_memory)."""
    if not ESCALATE_ON_LOOP:
        return None
    text = str(text or "").strip()
    if not text:
        return None
    if m := _CIRCLES.search(text):
        return f"the customer says we're going round in circles ({m.group(0).strip()!r})"
    messages = _messages(memory)
    ours = [t for d, t in messages if d == "outbound"]
    out_at = [i for i, (d, _) in enumerate(messages) if d == "outbound"]
    last = _question(ours[-1]) if ours and not _OFFER.search(ours[-1]) else ""
    for i in out_at[-3:-1] if _nothing_new(text) else []:
        # Our latest reply asked what one of the two before it asked (Kenneth: "Which SUV ...?", visit times, "Which
        # SUV model ...?"), the customer answered in between, and their answer now adds nothing ("Yes"): a third ask
        # goes nowhere. Not a visit offer re-made with new times, and not an answer that moves on ("morning is
        # better").
        if last and _similar(last, _question(messages[i][1])) and not _OFFER.search(messages[i][1]) and any(
                d == "inbound" for d, _ in messages[i + 1:out_at[-1]]):
            return f"we asked the same question twice ({last!r}) and the customer is answering again"
    theirs = [t for d, t in messages if d == "inbound"][-2:]
    now_topics = topics(text) - {"person"}
    if len(theirs) == 2 and now_topics and ours:
        repeated = now_topics & topics(theirs[0]) & topics(theirs[1])
        # Our reply between their messages: they asked, we answered, and they're asking again.
        answered = sum(1 for d, _ in messages[-4:] if d == "outbound") >= 1
        if repeated and answered:
            return f"the customer asked about the same thing three times running ({', '.join(sorted(repeated))})"
    return None


def same_topic(text: str | None, escalated_about: str | None) -> bool:
    """Whether a message after an escalation is about what the lead was escalated for. A message about none of the
    topics we know (a plain "ok", "?") is treated as the same: only a clearly new question is answered."""
    new = topics(text) - {"person"}
    if not new:
        return True
    return bool(new & topics(escalated_about))


def repeated_question(draft_text: str | None, memory: list[Any] | None) -> str | None:
    """The reply check before sending (the user, 3 Nov 2026: "before a reply goes out, check whether it answers what
    the customer actually asked; if not, rewrite it" - Kenneth Ball got "Which SUV ... link for?" twice): the question
    this draft ends with, when one of our last two replies already asked it. A visit offer with times is not one."""
    if not draft_text or _OFFER.search(draft_text):
        return None
    asked = _question(draft_text)
    if not asked:
        return None
    ours = [t for d, t in _messages(memory) if d == "outbound"][-2:]
    return asked if any(_similar(asked, _question(t)) and not _OFFER.search(t) for t in ours) else None
