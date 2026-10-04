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
- **Two levels, as the client wrote them** (decision 135): a channel opt-out,
  and "do not contact", which is every channel. "Never contact me again" is
  simply the every-channel case. Either way only what we start stops; a reply
  to the customer's own message still goes (decisions 136-137).

Opting back in (decision 138): START / UNSTOP (any case), or "YES" in capitals
only, reverse the channel they came on; a phrase from a short fixed list
("you can text me again", "you can contact me again") reverses the channel it
names, or every opted-out channel when it names none.

A *possible* opt-out the phrase list doesn't catch comes from Extract
(`possible_opt_out` + confidence) and only ever routes to REVIEW: the model
can make a send stricter, never allow one.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

Channel = Literal["sms", "email", "voice"]
ALL_CHANNELS: tuple[Channel, ...] = ("sms", "email", "voice")

STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt out", "opt-out", "revoke"}
START_WORDS = {"start", "unstop"}
# "YES" counts only in capitals (the user, 1 Oct, decision 138): a plain "yes" is usually an answer.
START_WORD_CAPS = "YES"

# Extract's possible opt-out routes to REVIEW at this confidence (decided 29 Sept).
POSSIBLE_OPT_OUT_REVIEW_CONFIDENCE = 0.5

NL_CONFIRMATION = "Understood, we won't contact you again."
_CONFIRM_VERBS = {"sms": "text", "email": "email", "voice": "call"}

_NOT = r"(?:do\s*n[o']?t|dont|don't|never|no\s+more|stop|quit)"
# Up to two words between "don't" and the verb ("don't ever text me"), but
# never a channel word: "don't email me, text is fine" is about email.
_FILL = (r"(?:(?!(?:text|texting|sms|email|e-mail|emailing|mail|call|calling|phone|contact|contacting|"
         r"message|messaging|reach)\b)\w+\s+){0,2}")
# (pattern, channels it names; None = every channel)
_PHRASES: list[tuple[re.Pattern[str], tuple[Channel, ...] | None]] = [
    (re.compile(rf"\b{_NOT}\s+{_FILL}(?:text|texting|txt|txting|sms|message\s+my\s+phone)(?:ing)?\b(?!\s+(?:you|u)\b)"),
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
    # PLAN_4 stream X1 item 2: the near variants the audit found missed (any length).
    (re.compile(r"\b(?:stop|quit|cease)\s+(?:all\s+)?(?:the\s+)?(?:calling|calls|phone\s+calls|ringing)\b"),
     ("voice",)),
    (re.compile(r"\bno\s+more\s+(?:phone\s+)?calls\b"), ("voice",)),
    (re.compile(r"\b(?:stop|quit)\s+sending\s+(?:me\s+)?(?:any\s+(?:more\s+)?)?(?:texts?|text\s+messages|txts?|sms)\b"),
     ("sms",)),
    (re.compile(r"\b(?:stop|quit)\s+sending\s+(?:me\s+)?(?:any\s+(?:more\s+)?)?e-?mails?\b"), ("email",)),
    (re.compile(r"\b(?:stop|quit)\s+sending\s+(?:me\s+)?(?:any\s+(?:more\s+)?)?(?:messages|msgs|stuff|these|this)\b"),
     None),
    (re.compile(r"\b(?:do\s*n[o']?t|dont|do\s+not)\s+(?:want|need)\s+(?:any\s*more|any|more|no\s+more)\s+"
                r"(?:texts?|text\s+messages|txts?|sms)\b"), ("sms",)),
    (re.compile(r"\b(?:do\s*n[o']?t|dont|do\s+not)\s+(?:want|need)\s+(?:any\s*more|any|more|no\s+more)\s+e-?mails?\b"),
     ("email",)),
    (re.compile(r"\b(?:do\s*n[o']?t|dont|do\s+not)\s+(?:want|need)\s+(?:any\s*more|any|more|no\s+more)\s+"
                r"(?:phone\s+)?calls\b"), ("voice",)),
    (re.compile(r"\b(?:do\s*n[o']?t|dont|do\s+not)\s+(?:want|need)\s+(?:any\s*more|any|more|no\s+more)\s+"
                r"(?:messages|contact)\b"), None),
    (re.compile(r"\bopt\s+me\s+out\b"), None),
    (re.compile(r"\bno\s+mas\s+(?:mensajes|textos|llamadas|correos)\b"), None),
    (re.compile(r"\bno\s+me\s+(?:escriba[ns]?|llame[ns]?|contacte[ns]?)\b"), None),
]

# A short message (at most SHORT_WORDS words) whose whole meaning is stopping contact (PLAN_4 stream X1 item 2):
# the stop word(s) plus nothing but politeness or emphasis. "stop by", "cancel my appointment" are not this.
SHORT_WORDS = 6
_STOP_TOKENS = {"stop", "stopall", "unsubscribe", "unsub", "cancel", "end", "quit", "optout", "revoke"}
_FILLER = {"please", "pls", "plz", "plez", "just", "now", "ok", "okay", "k", "seriously", "already", "immediately",
           "asap", "thanks", "thank", "you", "ty", "again", "all", "everything", "i", "said", "man", "dude", "guys",
           "sir", "maam", "lol", "omg", "yes", "yeah", "hell", "damn", "srsly", "right", "away", "for", "good",
           "forever", "permanently", "por", "favor"}
_SHORT_PHRASES: list[re.Pattern[str]] = [
    re.compile(r"^(?:i\s+)?(?:want|wanna|would\s+like|need)\s+to\s+(?:opt\s*-?\s*out|unsubscribe)"
               r"(?:\s+(?:please|now|of\s+(?:this|these|texts|messages|everything|all|your\s+list)))?$"),
    re.compile(r"^(?:please\s+)?(?:opt\s*-?\s*out|unsubscribe)(?:\s+(?:me|please|now|of\s+(?:this|these|"
               r"texts|messages|everything|all|your\s+list)))*$"),
    re.compile(r"^(?:please\s+)?remove\s+me(?:\s+(?:please|now|from\s+(?:this|it|here)))*$"),
    re.compile(r"^(?:please\s+)?take\s+me\s+off(?:\s+(?:of\s+)?(?:this|it|here|the\s+list|your\s+list))?"
               r"(?:\s+please)?$"),
    re.compile(r"^(?:please\s+)?(?:do\s*n[o']?t|dont|do\s+not)\s+contact(?:\s+me)?(?:\s+(?:again|anymore|"
               r"ever\s+again|please))*$"),
]
_DOUBLE_NEGATIVE = re.compile(r"^(?:do\s*n[o']?t|dont|don't|never)\s+(?:\w+\s+)?(?:stop|quit)\b")
# A word right before the match that turns it around: "don't stop texting me".
_NEGATORS = {"dont", "don't", "not", "never", "wont", "won't", "didnt", "didn't", "cant", "can't", "shouldnt",
             "shouldn't", "no"}


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
    """Lower case, curly quotes straightened, accents dropped ("más" → "mas"), emojis and punctuation
    removed, whitespace collapsed."""
    text = unicodedata.normalize("NFKD", (text or "").replace("’", "'"))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s'-]", " ", text.lower()).replace("_", " ")
    return re.sub(r"\s+", " ", text).strip()


def _short_opt_out(lowered: str) -> str | None:
    """A short message that only says stop (with politeness or emphasis): the matched text, or None."""
    words = lowered.replace("opt-out", "optout").replace("opt out", "optout").replace("-", " ").split()
    if not words or len(words) > SHORT_WORDS:
        return None
    stops = [w for w in words if w in _STOP_TOKENS]
    rest = [w for w in words if w not in _STOP_TOKENS]
    # "it" only goes with stop / quit ("stop it", "quit it"); "cancel it" is usually the appointment.
    if stops and any(s in ("stop", "quit") for s in stops):
        rest = [w for w in rest if w != "it"]
    if stops and all(w in _FILLER for w in rest):
        return lowered
    for pattern in _SHORT_PHRASES:
        if pattern.match(lowered):
            return lowered
    return None


def _negated(lowered: str, start: int) -> bool:
    before = lowered[:start].split()
    return bool(before) and before[-1] in _NEGATORS


def classify_keyword(text: str) -> Literal["stop", "start"] | None:
    bare = re.sub(r"[^\w\s-]", "", (text or "").strip()).strip()
    normalized = bare.lower()
    if normalized in STOP_WORDS:
        return "stop"
    if normalized in START_WORDS or bare == START_WORD_CAPS:
        return "start"
    return None


def confirmation_text(channels: tuple[Channel, ...]) -> str:
    """The one plain confirmation, saying only what was stopped (decision 139):
    "don't text me" mustn't be told "we won't contact you again" when email
    carries on."""
    if set(ALL_CHANNELS) <= set(channels):
        return NL_CONFIRMATION
    verbs = [_CONFIRM_VERBS[c] for c in ALL_CHANNELS if c in channels]
    return f"Understood, we won't {' or '.join(verbs)} you again."


# Opting back in, in the customer's words (decision 138). Short and channel-named on purpose:
# "yes" or "ok" alone are answers, never consent. "can" + whitespace, so "can't" never matches.
_CAN = r"(?:you\s+)?(?:can|may)\s+(?:now\s+)?"
_OK = r"\s+(?:is|are)\s+(?:fine|ok|okay|good)\b"
_OPT_INS: list[tuple[re.Pattern[str], tuple[Channel, ...] | None]] = [
    (re.compile(rf"\b{_CAN}(?:text|message|sms)\s+me(?:\s+again|\s+now)?\b"), ("sms",)),
    (re.compile(rf"\b(?:texting\s+me|texts){_OK}"), ("sms",)),
    (re.compile(r"\b(?:start|resume)\s+texting\s+me\b"), ("sms",)),
    (re.compile(rf"\b{_CAN}(?:e-?mail)\s+me(?:\s+again|\s+now)?\b"), ("email",)),
    (re.compile(rf"\b(?:e-?mailing\s+me|e-?mails){_OK}"), ("email",)),
    (re.compile(r"\b(?:start|resume)\s+e-?mailing\s+me\b"), ("email",)),
    (re.compile(rf"\b{_CAN}call\s+me\s+again\b"), ("voice",)),
    (re.compile(rf"\b{_CAN}(?:contact|reach)\s+me\s+again\b"), None),
    (re.compile(r"\b(?:start|resume)\s+contacting\s+me\b"), None),
    (re.compile(r"\bopt\s+me\s+(?:back\s+)?in\b"), None),
    (re.compile(r"\bresubscribe\s+me\b"), None),
]


@dataclass(frozen=True)
class OptIn:
    channels: tuple[Channel, ...] | None  # None: every channel the customer opted out of
    matched: str


def detect_opt_in(text: str) -> OptIn | None:
    """The customer's message as a natural-language opt-in, or None. Checked
    only after detect_opt_out found nothing ("don't text me" is never this)."""
    lowered = _normalize(text)
    for pattern, channels in _OPT_INS:
        if m := pattern.search(lowered):
            return OptIn(channels, m.group(0))
    return None


def detect_opt_out(text: str, channel: Channel) -> OptOut | None:
    """The customer's message as an opt-out, or None. `channel` is the one
    it arrived on (a keyword stops that channel)."""
    if classify_keyword(text) == "stop":
        return OptOut("keyword", (channel,), text.strip())
    lowered = _normalize(text)
    for pattern, channels in _PHRASES:
        for m in pattern.finditer(lowered):
            if (m.group(0).split()[0] in ("stop", "quit") and _negated(lowered, m.start())) or \
                    _DOUBLE_NEGATIVE.match(m.group(0)):
                continue  # "please don't stop texting me"
            return OptOut("phrase", channels or ALL_CHANNELS, m.group(0))
    if matched := _short_opt_out(lowered):
        # PLAN_4 stream X1 item 2: "please stop", "STOP ALL", "unsubscribe please": every channel, as the
        # customer didn't limit it, with our one confirmation (the carrier's keyword match needs the bare word).
        return OptOut("phrase", ALL_CHANNELS, matched)
    return None
