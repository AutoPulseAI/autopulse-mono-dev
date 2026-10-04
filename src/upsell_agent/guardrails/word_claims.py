"""Invented facts in words, not numbers (PLAN_4 stream X3 item 9).

The number check (draft_guard) misses claims written as words. These reached customers in the real gpt-5-mini run
(audit 4, A5):
- durations: "It usually takes about an hour to an hour and a half" (service-1), "most take about one to three
  hours" (service-3) - conversations.md's SERVICE example forbids inventing them;
- dealer process / policy: "We try to prequalify with a soft pull first so your score doesn't change" (credit-1),
  "No, you don't need to bring the title" (trade-1), a document list with "social security number" (credit-1),
  "We don't share prices over text" (credit-2), "no cost" (HANDOFF known gap);
- a hedge that still asserts the fact: "Yes — the team will confirm whether that specific vehicle has AWD"
  (general-1). "The team will confirm whether that vehicle has AWD" alone is fine.

Conservative patterns: a sentence that defers to the team ("the team will confirm / check / let you know ...")
is never a claim, so the safe wording always passes. A duration the customer gave themselves may be repeated.
"""

import re

_SENTENCE = re.compile(r"[^.!?\n]+[.!?]?")
_HEDGE = re.compile(
    r"\b(?:team|they|someone|a person|we|i)(?:'ll| will| can| would| could)\s+(?:\w+\s+)?"
    r"(?:confirm|check|verify|let you know|tell you|go over|walk you through|answer)\b"
    r"|\b(?:depends on|varies|not sure|can'?t say|can'?t confirm|don'?t know)\b", re.IGNORECASE)

_QTY = r"(?:an?|one|two|three|four|five|six|a few|few|a couple(?: of)?|couple(?: of)?|half an?|\d+(?:\.\d+)?)"
DURATION = re.compile(
    rf"\b(?:takes?|taking|lasts?|usually|typically|generally|normally|about|around|roughly|approximately|"
    rf"under|less than|within|only|just|should be done in)\b[^.!?\n]{{0,25}}?\b{_QTY}"
    rf"(?:\s*(?:-|to|or)\s*{_QTY})?(?:\s+and\s+a\s+half)?\s+(?:minutes?|mins?|hours?|hrs?)\b",
    re.IGNORECASE)
_CUSTOMER_DURATION = re.compile(rf"\b{_QTY}\s*(?:minutes?|mins?|hours?|hrs?)\b", re.IGNORECASE)

PROCESS = [
    ("soft or hard credit pull", re.compile(r"\b(?:soft|hard)\s+(?:credit\s+)?(?:pull|inquiry|check)s?\b", re.IGNORECASE)),
    ("credit score effect", re.compile(
        r"\b(?:won'?t|will not|doesn'?t|does not|shouldn'?t|should not|no)\s+(?:\w+\s+)?(?:affect|hurt|impact|ding|"
        r"drop|lower|change)\s+(?:your\s+)?(?:credit|score)\b|\b(?:score|credit)\s+(?:won'?t|doesn'?t|will not|does not)"
        r"\s+(?:change|drop|be affected)\b", re.IGNORECASE)),
    ("no cost / free", re.compile(
        r"\b(?:no|zero)\s+(?:cost|charge|fee)s?\b|\bfree of charge\b|\bat no (?:cost|charge)\b|\bcomplimentary\b"
        r"|\bfree\s+(?:appraisal|inspection|diagnostic|check|estimate|quote|car wash)\b|\bit'?s free\b", re.IGNORECASE)),
    ("what to bring", re.compile(
        r"\b(?:bring|need|have)\b[^.!?\n]{0,80}\b(?:social security|ssn|pay ?stubs?|proof of (?:income|insurance|"
        r"residence|address)|bank statements?|utility bill|the title|registration)\b"
        r"|\b(?:don'?t|do not|won'?t)\s+need\s+to\s+bring\b", re.IGNORECASE)),
    ("dealer pricing policy", re.compile(
        r"\bwe (?:don'?t|do not|never)\s+(?:share|give|quote|send|discuss)\s+(?:out\s+)?(?:prices?|pricing|numbers)\b",
        re.IGNORECASE)),
]
_YES_THEN_HEDGE = re.compile(
    r"^\s*(?:yes|yep|yeah|yup|absolutely|definitely|sure|of course|correct)\b[^.!?\n]*?"
    r"\b(?:will|'ll|can)\s+(?:\w+\s+)?(?:confirm|check|verify)\s+(?:whether|if)\b", re.IGNORECASE)


def check(text: str, customer_texts: list[str] | None = None) -> list[str]:
    """Violations for invented facts written in words; empty when none."""
    violations: list[str] = []
    customer_gave_duration = any(_CUSTOMER_DURATION.search(t or "") for t in customer_texts or [])
    for sentence in _SENTENCE.findall(text or ""):
        if _YES_THEN_HEDGE.search(sentence):
            violations.append(f"says yes and then that the team will confirm it: {sentence.strip()!r}")
            continue
        def deferred(match: re.Match, sentence: str = sentence) -> bool:
            # "The team will confirm whether it's a soft pull": the claim sits inside the deferral, after it.
            return bool(_HEDGE.search(sentence[:match.start()]))

        if not customer_gave_duration and (m := DURATION.search(sentence)) and not deferred(m):
            violations.append(f"states a duration no one gave us: {m.group(0)!r}")
        for label, pattern in PROCESS:
            if (m := pattern.search(sentence)) and not deferred(m):
                violations.append(f"states a dealer process or policy no one gave us ({label}): {m.group(0)!r}")
    return violations
