"""Plain language checks (MASTER_PLAN_2 Phase 7), plain code, same answer every
time.

- `find_jargon`: internal terms that must never reach a customer: slot codes
  ("trade_in.condition"), snake_case words ("this_week"), and our own words
  for the process ("slot", "lead type"). The guard sends a draft that has any
  back for a rewrite; the scenario runner checks every reply it sees.
- `reading_grade`: the Flesch-Kincaid grade level of a text, for the eval
  gate (target: grade 8 or below, architecture §15).
"""

import re

_URL_OR_EMAIL = re.compile(r"https?://\S+|www\.\S+|\S+@\S+")
_SLOT_CODE = re.compile(r"\b(?:interest|trade_in|vehicle|contact|service|appointment)\.[a-z_]+\b")
_SNAKE = re.compile(r"\b[a-z]+(?:_[a-z0-9]+)+\b")
_PROCESS_WORDS = re.compile(r"\b(slots?|lead[ _]type|needs[ _]confirming|required details|qualification)\b",
                            re.IGNORECASE)

READING_GRADE_TARGET = 8.0


def find_jargon(text: str) -> list[str]:
    """Internal terms in a customer-facing text, in the order found."""
    text = _URL_OR_EMAIL.sub(" ", text or "")
    found: list[str] = []
    for pattern in (_SLOT_CODE, _SNAKE, _PROCESS_WORDS):
        for match in pattern.finditer(text):
            if match.group(0) not in found:
                found.append(match.group(0))
    return found


def _syllables(word: str) -> int:
    word = word.lower().strip("'")
    if len(word) <= 3:
        return 1
    word = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", word)
    word = re.sub(r"^y", "", word)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", word)))


def reading_grade(text: str) -> float:
    """Flesch-Kincaid grade level: 0.39 * words/sentence + 11.8 * syllables/word - 15.59."""
    text = _URL_OR_EMAIL.sub(" ", text or "")
    words = re.findall(r"[A-Za-z][A-Za-z']*", text)
    if not words:
        return 0.0
    sentences = max(1, len([s for s in re.split(r"[.!?]+", text) if re.search(r"[A-Za-z]", s)]))
    syllables = sum(_syllables(w) for w in words)
    return round(0.39 * len(words) / sentences + 11.8 * syllables / len(words) - 15.59, 1)
