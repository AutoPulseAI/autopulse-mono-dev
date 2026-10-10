"""Guard: a reply carries only the links this turn's plan allows (MASTER_PLAN_4 F3, conversation_7).

Client (conversation_6, scope §7 Workflow 3): "we want to send an image not the link unless the customer asks
for it cause we don't want to take the customer off the conversation... Sending them to the website will not
help advance to appt unless the customer specifically asks for the link."
Client (conversation_7): "Should never ever be an autopulse link of any kind."

agent/link_resolver.py decides in code which URLs a reply may carry (a vehicle's own page, the dealership's
homepage, both, or none) and fills them in. A draft fails when any version (SMS, email subject, email body) has:
- a URL that isn't one of the plan's (the homepage included: it is no longer allowed on its own), or
- any autopulse.ai URL, whatever the plan says, or
- a link placeholder Compose wrote that was never filled.
"""

import re
from collections.abc import Iterable
from typing import Any

_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"'()\[\]]+", re.IGNORECASE)
_TRAILING = ".,;:!?"
_PLACEHOLDER = re.compile(r"\[\s*(?:VEHICLE|WEBSITE)_LINK\s*\]|\{\{\s*\w+\s*\}\}", re.IGNORECASE)
_BLOCKED_DOMAIN = re.compile(r"(?:^|\.)autopulse\.ai$", re.IGNORECASE)


def _norm(url: str) -> str:
    url = url.strip().rstrip(_TRAILING).lower()
    url = re.sub(r"^https?://", "", url)
    url = url.removeprefix("www.")
    return url.rstrip("/")


def _host(url: str) -> str:
    return _norm(url).split("/", 1)[0].split(":", 1)[0]


def find_urls(text: str) -> list[str]:
    return [m.group(0).rstrip(_TRAILING) for m in _URL.finditer(text or "")]


def disallowed_links(draft: dict[str, Any] | None, *, allowed: Iterable[str | None] = (),
                     homepage: str | None = None) -> list[str]:
    """Why the draft's links can't go out; empty when it has none, or only allowed ones. `homepage`: the
    dealership's website, also caught written bare ("victorycarscentral.com") when the plan doesn't allow it."""
    draft = draft or {}
    ok = {_norm(u) for u in allowed if u}
    bare_home = _host(homepage) if homepage and _norm(homepage) not in ok else None
    violations: list[str] = []
    for name, key in (("SMS", "sms_text"), ("email subject", "email_subject"), ("email", "email_body")):
        text = str(draft.get(key) or "")
        if _PLACEHOLDER.search(text):
            violations.append(f"the {name} still has a link placeholder: write the message without it")
        if bare_home and re.search(rf"\b{re.escape(bare_home)}\b", _URL.sub(" ", text), re.IGNORECASE):
            violations.append(f"the {name} points them to our website ({bare_home}), which this reply may not carry")
        for url in find_urls(text):
            if _BLOCKED_DOMAIN.search(_host(url)):
                violations.append(f"the {name} has an AutoPulse link ({url}): never send one")
            elif _norm(url) not in ok:
                violations.append(f"the {name} has a link ({url}) this reply may not carry: write no URLs yourself, "
                                  "use only the link placeholders you were given")
    return violations
