"""Never "what day works?" - always two real times (Betsy, 2 Nov 2026 meeting).

A payments question got "we can work through all the details together when you come in. What day works?" and the
customer answered "I'll get back to you". Betsy: "we have to offer times ... if you don't offer times this is the
response you get"; the user, 3 Nov 2026: "we should not ask them, we should offer them: will you be available on this
date at this time?".

`offer_real_times()` runs on the finished draft: an open question about when they'd come in is replaced by the two
earliest open times (the same times a visit offer gives), unless the reply already carries times.
"""

import re
from typing import Any

from upsell_agent import clock
from upsell_agent.tools import booking_tool

ON = True  # AI Studio -> Conversation rules

_OPEN = re.compile(
    r"[^.!?\n]*\b(?:(?:what|which) (?:day|days|time|times|day and time|date)(?: and time)? (?:works?|would work|is best|"
    r"suits|is good|fits)|when (?:would|could|can|will|do) you (?:like to |want to |be able to )?(?:come|stop|swing|"
    r"visit|make it|drop)|when (?:works|is (?:a )?good(?: time)?|are you (?:free|available))(?: for you)?|"
    r"let me know (?:what|which|when) (?:day|time|works))\b[^.!?\n]*\?", re.IGNORECASE)
_HAS_TIME = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b", re.IGNORECASE)


async def offer_real_times(draft: dict[str, Any], *, dealer_id: str, lead_id: str | None, decision: dict[str, Any],
                           dealer: Any) -> str | None:
    """Replaces the open question in place; returns what was done (for the trace), or None."""
    if not ON or decision.get("reply_language") or (decision.get("visit_offer") or {}).get("times"):
        return None
    if decision.get("ask_when_free") or decision.get("next_action") or decision.get("dated"):
        return None  # "busy, talk later": when to get back to them, not a visit (Betsy, 21 Oct 2026)
    texts = [str(draft.get(k) or "") for k in ("sms_text", "email_body")]
    if not any(_OPEN.search(t) and not _HAS_TIME.search(t) for t in texts):
        return None
    now = clock.now()
    existing = await booking_tool.existing_bookings(dealer_id, dealer, now)
    times = booking_tool.format_offer(booking_tool.offer_times(
        booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id), count=2), dealer)
    if len(times) < 2:
        return None
    ask = f" Would {times[0]['display']} or {times[1]['display']} work for you?"
    for key in ("sms_text", "email_body"):
        text = str(draft.get(key) or "")
        if text and not _HAS_TIME.search(text):
            draft[key] = _OPEN.sub(ask, text, count=1).replace("  ", " ")
    draft["offered_times"] = times
    return f"An open \"what day works?\" replaced by two real times ({times[0]['display']}, {times[1]['display']})."
