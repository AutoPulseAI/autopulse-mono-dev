"""No timed message after the customer said no, later, or "I'll call you".

27 Oct 2026: Salvatore Giangrande wrote "No longer interested" - the AI asked why (as it should, once) and 16 minutes
later an AI Studio touch offered him visit times. Michael Brazza ("bed-bound, have a doctor visit, will call you when I
am able") and Kashaun Blue ("I'm in Columbus Ohio, I will not be able to come in") got "Still with me?" the same way.
Each timer checked the lead's stage, not what the customer had just said.

After each customer message the turn records a hold on the lead (`customer_hold`) when the customer:
- is not interested (the same signal Decide uses): held until they write again - staff decide what happens next;
- declines a visit, asks to be contacted later, says they'll reach out, or says we're too far: held HOLD_DAYS.
A new message from the customer replaces the hold. While it holds, the timers in HELD_KINDS don't send (the pre-send
re-check, lifecycle.stage_check); replies to the customer, appointments, a dated next step they asked for and staff
tasks are not touched.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock

ENABLED = True  # AI Studio > Compliance > Safeguards
HOLD_DAYS = 3
CONFIDENCE = 0.8
# Timed messages the AI starts on its own. Not here: replies, appointment steps, next_action (a time the customer
# asked for), visit follow-ups, handoff checks, staff call tasks.
HELD_KINDS = {None, "channel_switch", "cadence_touch", "studio_touch", "staff_quiet_resume"}

# What the model can miss (Michael Brazza's "will call you when I am able" came back with no signal).
_THEY_WILL_REACH_OUT = re.compile(
    r"\b(?:i'?ll|i will|will)\s+(?:call|text|reach out|contact|get back|let you know)\b"
    r"|\b(?:call|text|reach out to|get back to) you (?:when|once|later|after|tomorrow|next)\b"
    r"|\bwhen i(?:'m| am) (?:able|ready|free|better)\b", re.IGNORECASE)
# Lily Dochev, 27 Oct 2026: "I'm all set, thank you for asking" got "Want to stop by?" and 16 minutes later "Still with
# me?". A polite no - the AI thanks them and stops (agent/nodes/decide.py), and no timed message follows.
ALL_SET = re.compile(r"^\W*(?:no,?\s*)?(?:i'?m|i am|we'?re|we are)\s+(?:all\s+set|good|ok(?:ay)?|fine|all\s+good)\b(?!\s+(?:with|for)\s+"
                     r"(?:tomorrow|today|\d|the\s+appointment|monday|tuesday|wednesday|thursday|friday|saturday|sunday))"
                     r"|^\W*(?:all\s+good|no\s+thanks?|no\s+thank\s+you|not\s+anymore|i'?ll\s+pass)\b", re.IGNORECASE)
_TOO_FAR = re.compile(r"\btoo far\b|\bfar away\b|\bout of state\b|\bnot (?:located|local) (?:in|near)\b"
                      r"|\bwill not be able to come\b|\bcan'?t (?:come|make it) (?:in|there)\b", re.IGNORECASE)


def _sure(extraction: dict, flag: str) -> bool:
    return bool(extraction.get(flag)) and float(extraction.get(f"{flag}_confidence") or 0.0) >= CONFIDENCE


def hold_for(extraction: dict[str, Any] | None, text: str | None, now: datetime | None = None) -> dict | None:
    """The hold this customer message puts on the AI's own timed messages, or None."""
    if not ENABLED:
        return None
    ex, said, now = extraction or {}, str(text or ""), now or clock.now()
    if _sure(ex, "not_interested") or (ALL_SET.search(said) and "?" not in said):
        return {"at": now, "until": None, "reason": "the customer said they're not interested"}
    if _sure(ex, "declines_visit") or _TOO_FAR.search(said):
        why = "the customer can't or won't come in"
    elif ex.get("next_contact_when") or ex.get("visit_later_when") or _THEY_WILL_REACH_OUT.search(said):
        why = "the customer asked for later / will reach out"
    else:
        return None
    return {"at": now, "until": now + timedelta(days=HOLD_DAYS), "reason": why}


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def check(state: dict | None, kind: str | None, now: datetime | None = None) -> tuple[str, bool, str]:
    """The pre-send re-check's hold line, as (check, passed, detail)."""
    hold = (state or {}).get("customer_hold")
    if not ENABLED or not hold or kind not in HELD_KINDS:
        return "customer_hold", True, "no hold"
    until = _aware(hold.get("until"))
    if until and (now or clock.now()) >= until:
        return "customer_hold", True, "the hold has ended"
    return "customer_hold", False, f"held: {hold.get('reason')}" + (f" until {until:%Y-%m-%d}" if until else "")
