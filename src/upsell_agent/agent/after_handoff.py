"""After a handoff the customer is never met with silence (PLAN_4 stream X3 item 4).

Audit 4, trade-2 (real gpt-5-mini run): an "upset 0.80" handoff, then "Fine, what would the appraisal involve?",
"Could I come Saturday at 11?", "Actually make it Friday at 4 instead" - all three saved for staff with no reply
(one holding reply per 2 hours), so a customer booking themselves was lost.

Now, in code, for each batch of messages on a handed-off lead:
- a request to book (a visit word plus a day or time) or a question is a `request`: staff get it at once (a staff
  notice and a CRM note), and the customer gets a holding reply even inside the 2-hour window (at most one per
  HOLDING_REPLY_MIN_GAP);
- when the handoff was a *soft* one (the AI couldn't write a safe reply, or it read the customer as upset) and the
  customer now asks to book, the AI takes the lead back and books it - nothing a person needed to decide was
  pending.
"""

import re
from datetime import datetime, timedelta

from upsell_agent.slots.dates import resolve as resolve_date

HOLDING_REPLY_MIN_GAP = timedelta(minutes=10)

_VISIT_WORDS = re.compile(
    r"\b(?:come (?:in|by|down|over)|come\b|stop (?:in|by)|swing by|drop (?:it )?(?:off|by|in)|book|booking|appointment|"
    r"appt|schedule|reschedule|make it|move it|visit|bring (?:it|the \w+) (?:in|by))\b", re.IGNORECASE)
_TIME = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\b(?:morning|afternoon|evening|noon|tonight)\b", re.IGNORECASE)
_QUESTION_START = re.compile(
    r"^\s*(?:what|how|when|where|which|who|why|can|could|do|does|did|is|are|will|would|should|may)\b", re.IGNORECASE)


def asks_to_book(text: str, now: datetime) -> bool:
    """A visit word plus a day or a time ("Could I come Saturday at 11?", "Actually make it Friday at 4")."""
    if not _VISIT_WORDS.search(text or ""):
        return False
    return bool(_TIME.search(text) or resolve_date(text, now))


def asks_question(text: str) -> bool:
    return any("?" in line or _QUESTION_START.search(line) for line in (text or "").splitlines() if line.strip())


def classify(text: str, now: datetime) -> str | None:
    """"booking", "question" or None (a plain "ok thanks" needs no reply beyond the 2-hour holding rule)."""
    if asks_to_book(text, now):
        return "booking"
    if asks_question(text):
        return "question"
    return None


def is_soft_handoff(state: dict) -> bool:
    """The handoff needed no person's decision: the AI couldn't write a safe reply, or it read the customer as
    upset (agent/turn.py sets `handoff_soft`; older rows are read from the reason)."""
    if state.get("handoff_soft") is not None:
        return bool(state["handoff_soft"])
    reason = str(state.get("status_reason") or "")
    return reason.startswith("AI couldn't write a safe reply") or reason.startswith("Customer is clearly upset")
