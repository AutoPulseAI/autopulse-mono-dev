"""Opt-outs in the customer's words (MASTER_PLAN_3 C1 item 3, architecture
§15 decisions 74-75). Pure code; no model.

- **Keywords** (carrier standard): a message that is ONLY "STOP",
  "UNSUBSCRIBE", ... "I don't want to stop by today" is not one. Stops the
  channel it came on; the carrier sends its own confirmation, so we send none.
- **Phrases**: a fixed list ("don't text me", "leave me alone", ...). A
  phrase that names a channel stops that channel; one that names none stops
  every channel, because the customer didn't limit it. We send one plain,
  non-marketing confirmation on the channel it came in on.
- **Objections are not opt-outs**: "I'm not interested", "not right now".

A *possible* opt-out the phrase list doesn't catch comes from Extract
(`possible_opt_out` + confidence) and only ever routes to REVIEW: the model
can make a send stricter, never allow one.
"""

import re
from dataclasses import dataclass
from typing import Literal

Channel = Literal["sms", "email", "voice"]
ALL_CHANNELS: tuple[Channel, ...] = ("sms", "email", "voice")

STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt out", "opt-out", "revoke"}
START_WORDS = {"start", "unstop", "yes"}

# Extract's possible opt-out routes to REVIEW at this confidence (decided 29 Sept).
POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE = 0.5

NL_CONFIRMATION = "Understood, we won't contact you again."

_NOT = r"(?:do\s*n[o']?t|dont|don't|never|no\s+more|stop)"
# Up to two words between "don't" and the verb ("don't ever text me"), but
# never a channel word: "don't email me, text is fine" is about email.
_FILL = (r"(?:(?!(?:text|texting|sms|email|e-mail|emailing|mail|call|calling|phone|contact|contacting|"
         r"message|messaging|reach)\b)\w+\s+){0,2}")
# (pattern, channels it names; None = every channel)
_PHRASES: list[tuple[re.Pattern[str], tuple[Channel, ...] | None]] = [
    (re.compile(rf"\b{_NOT}\s+{_FILL}(?:text|texting|sms|message\s+my\s+phone)(?:ing)?\b(?!\s+(?:you|u)\b)"),
     ("sms",)),
    (re.compile(r"\b(?:remove|delete|take)\s+my\s+(?:phone\s+)?number\b"), ("sms", "voice")),
    (re.compile(r"\bno\s+more\s+(?:texts|text\s+messages|sms)\b"), ("sms",)),
    (re.compile(rf"\b{_NOT}\s+{_FILL}(?:email|e-mail|emailing|mail)(?:ing)?\b"), ("email",)),
    (re.compile(r"\b(?:remove|delete|take)\s+my\s+email\b"), ("email",)),
    (re.compile(r"\bno\s+more\s+emails?\b"), ("email",)),
    (re.compile(rf"\b{_NOT}\s+{_FILL}(?:call|calling|phone)(?:ing)?\s+me\b"), ("voice",)),
    (re.compile(rf"\b{_NOT}\s+{_FILL}(?:contact|contacting|message|messaging|reach(?:ing)?\s+out\s+to)\s+me\b"),
     None),
    (re.compile(r"\bleave\s+me\s+alone\b"), None),
    (re.compile(r"\btake\s+me\s+off\s+(?:your|the)\s+(?:list|lists|mailing\s+list)\b"), None),
    (re.compile(r"\bremove\s+me\s+from\s+(?:your|the)\s+(?:list|lists|database)\b"), None),
    (re.compile(r"\bno\s+more\s+messages\b"), None),
    (re.compile(r"\bunsubscribe\s+me\b"), None),
    (re.compile(r"\blose\s+my\s+(?:number|contact)\b"), None),
]


@dataclass(frozen=True)
class OptOut:
    kind: Literal["keyword", "phrase"]
    channels: tuple[Channel, ...]
    matched: str

    @property
    def confirm(self) -> bool:
        """Only a phrase gets our confirmation; the carrier confirms keywords."""
        return self.kind == "phrase"


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s'-]", "", (text or "").replace("’", "'").strip().lower()).strip()


def classify_keyword(text: str) -> Literal["stop", "start"] | None:
    normalized = re.sub(r"[^\w\s-]", "", (text or "").strip().lower()).strip()
    if normalized in STOP_WORDS:
        return "stop"
    if normalized in START_WORDS:
        return "start"
    return None


def detect_opt_out(text: str, channel: Channel) -> OptOut | None:
    """The customer's message as an opt-out, or None. `channel` is the one
    it arrived on (a keyword stops that channel)."""
    if classify_keyword(text) == "stop":
        return OptOut("keyword", (channel,), text.strip())
    lowered = _normalize(text)
    for pattern, channels in _PHRASES:
        if m := pattern.search(lowered):
            return OptOut("phrase", channels or ALL_CHANNELS, m.group(0))
    return None
