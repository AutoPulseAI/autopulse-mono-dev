"""Never "what day works?" - always two real times (Betsy, 2 Nov 2026 meeting).

A payments question got "we can work through all the details together when you come in. What day works?" and the
customer answered "I'll get back to you". Betsy: "we have to offer times ... if you don't offer times this is the
response you get"; the user, 3 Nov 2026: "we should not ask them, we should offer them: will you be available on this
date at this time?".

`offer_real_times()` runs on the finished draft: an open question about when they'd come in is replaced by the two
earliest open times (the same times a visit offer gives), unless the reply already carries times.
"""

import re
from datetime import date, timedelta
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


def _from_day(extraction: dict[str, Any], decision: dict[str, Any], dealer: Any,
              now: Any) -> booking_tool.DayRequest | None:
    """Where the times start, from what the AI understood the customer said (AMMAR Saleh, 3 Nov 2026: "I forgot today,
    election day" - the AI saw today was out, and this step still put today at 1:00 PM and 2:00 PM in its reply; the
    user: "give him the time for next day or any other day of his preference - that's common sense"):
    - a day they'd come instead ("maybe Friday", "the end of the week"): that day (Saturday and Sunday);
    - a day that doesn't work ("I forgot today"): the day after it;
    - they turned down the times we offered: the day after the last day those were on;
    - otherwise None (the earliest open times)."""
    from upsell_agent.agent.nodes.decide import day_after_not_on

    if later := str(extraction.get("visit_later_when") or ""):
        if request := booking_tool.preferred_day(later, dealer, now):
            return request
    if request := day_after_not_on(extraction, dealer, now):
        return request
    offered = ((decision.get("visit_plan") or {}).get("record") or {}).get("offered_times") or []
    days = [o["date"] for o in offered if o.get("date")]
    if extraction.get("declines_visit") and days:
        return booking_tool.DayRequest(day=date.fromisoformat(max(days)) + timedelta(days=1), part=None,
                                       part_words=None)
    return None


async def offer_real_times(draft: dict[str, Any], *, dealer_id: str, lead_id: str | None, decision: dict[str, Any],
                           dealer: Any, extraction: dict[str, Any] | None = None) -> str | None:
    """Replaces the open question in place; returns what was done (for the trace), or None."""
    if not ON or decision.get("reply_language") or (decision.get("visit_offer") or {}).get("times"):
        return None
    if decision.get("ask_when_free") or decision.get("next_action") or decision.get("dated"):
        return None  # "busy, talk later": when to get back to them, not a visit (Betsy, 21 Oct 2026)
    texts = [str(draft.get(k) or "") for k in ("sms_text", "email_body")]
    if not any(_OPEN.search(t) and not _HAS_TIME.search(t) for t in texts):
        return None
    now = clock.now()
    start = _from_day(extraction or {}, decision, dealer, now)
    today = now.astimezone(dealer.tz).date()
    span = booking_tool.DAYS_AHEAD + max(0, (start.day - today).days) if start else booking_tool.DAYS_AHEAD
    existing = await booking_tool.existing_bookings(dealer_id, dealer, now, days_ahead=span)
    available = booking_tool.available_times(dealer, existing, now, exclude_lead_id=lead_id, days_ahead=span)
    picked = booking_tool.times_on_day(available, start, dealer, count=2)[0] if start else \
        booking_tool.offer_times(available, count=2)
    times = booking_tool.format_offer(picked, dealer)
    if len(times) < 2:
        return None
    second = times[1]["display"]
    if times[0]["date"] == times[1]["date"]:
        second = second.split(" at ", 1)[-1]  # "tomorrow (Wednesday) at 10:00 AM or 4:00 PM"
    ask = f" Would {times[0]['display']} or {second} work for you?"
    for key in ("sms_text", "email_body"):
        text = str(draft.get(key) or "")
        if text and not _HAS_TIME.search(text):
            draft[key] = _OPEN.sub(ask, text, count=1).replace("  ", " ")
    draft["offered_times"] = times
    return f"An open \"what day works?\" replaced by two real times ({times[0]['display']}, {times[1]['display']})."
