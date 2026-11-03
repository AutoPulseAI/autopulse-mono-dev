"""A customer email that reaches us as its raw source (Dominick Telesco, 2 Nov 2026: "X-Received: by 2002:a05:620a...
ARC-Seal: ..." was read as his message - a price offer from our own quoted price, a "new number" from a header id, and
his lead set to Contacted).

`readable()` gives what the customer wrote: the plain-text body of the raw email, without our quoted message below
it. Anything that isn't a raw email is returned as it is.
"""

import email
import re
from email import policy

_RAW = re.compile(r"^\s*(?:X-[\w-]+|Received|ARC-[\w-]+|Return-Path|Delivered-To|DKIM-Signature|"
                  r"Authentication-Results|MIME-Version|Message-ID|Content-Type|From|To|Subject|Date):\s", re.IGNORECASE)
_QUOTE_START = re.compile(r"^\s*(?:On .{5,200}wrote:|-{2,} ?Original Message|From: .+|Sent from my \w+|>)",
                          re.IGNORECASE | re.MULTILINE)
_TAG = re.compile(r"<[^>]+>")


def is_raw(text: str | None) -> bool:
    head = str(text or "")[:2000]
    return bool(_RAW.match(head)) and len(re.findall(r"(?m)^[\w-]+: ", head)) >= 3


def readable(text: str | None) -> str:
    """The customer's own words from a raw email source; other text unchanged. "" when the raw email has no body."""
    if not is_raw(text):
        return str(text or "")
    try:
        message = email.message_from_string(str(text), policy=policy.default)
        part = message.get_body(preferencelist=("plain", "html"))
        body = part.get_content() if part is not None else ""
        if part is not None and part.get_content_type() == "text/html":
            body = _TAG.sub(" ", body)
    except Exception:  # noqa: BLE001 - an unreadable source is no message
        return ""
    if m := _QUOTE_START.search(body):
        body = body[:m.start()]
    return re.sub(r"[ \t]+", " ", body).strip()
