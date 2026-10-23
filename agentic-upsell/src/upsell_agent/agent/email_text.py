"""An email reply as the words the customer wrote (live, 23 Oct 2026: Manuel's email reached the AI as raw HTML -
"<html><head><meta http-equiv=...").

HTML becomes plain text (style / script / head dropped, tags removed, entities decoded), and the quoted older
message under the reply ("On Thu, Oct 23, 2026 ... wrote:", "-----Original Message-----", "From: ... Sent: ...")
is cut off. Plain text goes through unchanged apart from that cut.
"""

import html
import re

_LOOKS_HTML = re.compile(r"<\s*(?:html|body|div|p|br|table|span|head|meta)\b", re.IGNORECASE)
_DROP_BLOCKS = re.compile(r"<\s*(head|style|script)\b.*?<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAKS = re.compile(r"<\s*(?:br|/p|/div|/tr|/li|/h\d)\s*/?\s*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
# Where the quoted earlier message starts.
_QUOTE_START = re.compile(
    r"^\s*(?:On\s.{3,120}?\bwrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+(?:\n|\s)+Sent:\s|"
    r"Sent from my (?:iPhone|iPad|Android|Samsung|mobile)|_{5,})", re.IGNORECASE | re.MULTILINE)


def plain_text(text: str | None) -> str:
    raw = str(text or "")
    if _LOOKS_HTML.search(raw):
        raw = _DROP_BLOCKS.sub(" ", raw)
        raw = _BREAKS.sub("\n", raw)
        raw = html.unescape(_TAGS.sub(" ", raw))
    if (m := _QUOTE_START.search(raw)) and raw[:m.start()].strip():
        raw = raw[:m.start()]
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in raw.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
