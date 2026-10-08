"""Guard: no link unless the customer asked for one (MASTER_PLAN_4 F3).

Client (conversation_6, scope §7 Workflow 3): "we want to send an image not the link unless the customer asks
for it cause we don't want to take the customer off the conversation... Sending them to the website will not
help advance to appt unless the customer specifically asks for the link."

A draft fails when any version (SMS, email subject, email body) has a URL and either:
- the customer didn't ask for a link this turn (Extract's `wants_link`, ≥ 0.8 - agent/vehicle_media.py), or
- the URL isn't the `page_url` of a vehicle named in that same version (`sms_vins` for the SMS, `email_vins`
  for the email), exactly as the inventory record has it.

Exceptions: the dealership's own links from its record (context.dealer.info) - the website (kept from before F3,
MASTER_PLAN_2 Phase 6) and the credit application and trade-in appraisal pages (client, 8 Oct 2026) - when the
customer asks for them: an answer to their question, not a vehicle link.
"""

import re
from collections.abc import Iterable
from typing import Any

_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"'()\[\]]+", re.IGNORECASE)
_TRAILING = ".,;:!?"


def _norm(url: str) -> str:
    url = url.strip().rstrip(_TRAILING).lower()
    url = re.sub(r"^https?://", "", url)
    url = url.removeprefix("www.")
    return url.rstrip("/")


def find_urls(text: str) -> list[str]:
    return [m.group(0).rstrip(_TRAILING) for m in _URL.finditer(text or "")]


def disallowed_links(draft: dict[str, Any] | None, *, inventory: list[dict[str, Any]] | None,
                     link_requested: bool, allowed: Iterable[str | None] = ()) -> list[str]:
    """Why the draft's links can't go out; empty when it has none, or only allowed ones."""
    draft = draft or {}
    by_vin = {r["vin"]: r for r in inventory or [] if r.get("vin")}
    always = {_norm(u) for u in allowed if u}
    violations: list[str] = []
    for name, key, vins_key in (("SMS", "sms_text", "sms_vins"), ("email subject", "email_subject", "email_vins"),
                                ("email", "email_body", "email_vins")):
        pages = {_norm(page) for v in draft.get(vins_key) or [] if (page := (by_vin.get(v) or {}).get("page_url"))}
        for url in find_urls(str(draft.get(key) or "")):
            if _norm(url) in always:
                continue
            if not link_requested:
                violations.append(f"the {name} has a link ({url}) but the customer didn't ask for one "
                                  "(send the photo, not the link)")
            elif _norm(url) not in pages:
                violations.append(f"the {name} links to {url}, which isn't the page of a vehicle it names")
    return violations
