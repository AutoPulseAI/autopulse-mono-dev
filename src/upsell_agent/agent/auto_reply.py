"""Auto-responders on the customer's side (PLAN_4 stream X3 item 10).

An out-of-office email or a "driving, I'll get back to you" text is not the customer talking: it gets no reply (a
bot answering every message would be an endless paid exchange), is not meaningful contact (no stage change, the
call task stays), and does not cancel the channel switch.

The CRM marks an email whose headers say so (`Auto-Submitted` other than "no", `X-Autoreply`, `X-Autorespond`,
`Precedence: auto_reply|bulk|junk`, `X-Auto-Response-Suppress`) as `auto_reply` on the event (aidmvcs-be-dev
app/lib/ai/aiDispatch.js `isAutoReplyRecord`); the phrases below catch the rest, in any channel.
"""

import re

_PHRASES = re.compile(
    r"\b(?:out of (?:the )?office|ooo\b|automatic reply|auto[- ]?reply|autoreply|auto[- ]?response|"
    r"this is an automated (?:message|response|reply)|i am currently (?:away|out|on (?:vacation|leave|holiday))|"
    r"i'?m currently (?:away|out of)|away from (?:my desk|the office)|on (?:annual )?(?:leave|vacation|holiday) until|"
    r"(?:will|shall) (?:respond|reply|get back to you) (?:to your (?:email|message) )?(?:when|upon|as soon as) "
    r"(?:i|we) return|limited access to (?:email|my email)|"
    r"(?:i'?m|i am) driving with do not disturb|do not disturb while driving|"
    r"this mailbox is (?:not monitored|unattended)|do not reply to this (?:email|message))",
    re.IGNORECASE)


def is_auto_reply(text: str | None, *, flagged: bool = False) -> bool:
    """True for an auto-responder's message. `flagged`: the CRM saw auto-reply headers."""
    return flagged or bool(_PHRASES.search(text or ""))
