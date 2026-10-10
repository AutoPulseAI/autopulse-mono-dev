"""Guard: "we don't have X" only about what this turn's search looked for (conversation_7, 10 Oct 2026).

Seen live: "Do u have sonata in stock?" got "We don't have any Hyundai Sonata listed in our inventory right now"
when the search had looked for "rdx acura" - and "what vehicles do you have" got "We don't have any vehicles
listed", from a dealer with thousands. A draft fails when it says we don't have something and:

- no stock search ran this turn (context.stock_search absent), or
- it names a vehicle the search didn't look for (a make or model word that isn't in `searched_for`), or
- it says we have nothing at all while the search was narrowed to a vehicle, or found some.
"""

import re
from typing import Any

from upsell_agent.tools.inventory_tool import KNOWN_MAKES

# "we don't have (any) X", "we do not have X", "X isn't in stock", "no X in (our) stock/inventory", "we're out of X".
_CLAIM = re.compile(
    r"\b(?:we|i)\s+(?:don'?t|do not|currently don'?t|currently do not)\s+(?:have|carry|see)\s+(?P<a>[^.!?]{1,60})"
    r"|\bno\s+(?P<b>[^.!?]{1,40}?)\s+(?:in|on)\s+(?:our\s+|the\s+)?(?:stock|inventory|lot)\b"
    r"|\b(?:we'?re|we are)\s+out of\s+(?P<c>[^.!?]{1,40})", re.IGNORECASE)
_EVERYTHING = re.compile(r"^\s*(?:any\s+)?(?:vehicles|cars|inventory|stock|anything)\b", re.IGNORECASE)
_STOCKY = re.compile(r"\b(?:in stock|in (?:our )?inventory|on (?:our|the) lot|listed|available)\b", re.IGNORECASE)
_WORD = re.compile(r"[a-z0-9-]+")


def _words(text: str) -> set[str]:
    return {re.sub(r"[^a-z0-9]", "", w) for w in _WORD.findall(text.lower())}


def unsupported_stock_claims(draft: dict[str, Any] | None, *, stock_search: dict[str, Any] | None,
                             inventory: list[dict[str, Any]] | None, vehicle_words: set[str]) -> list[str]:
    """Why the draft's "we don't have ..." can't go out; empty when it makes none, or only grounded ones.
    `vehicle_words`: make and model words this dealer carries (lowercase, no spaces/dashes) plus the known makes -
    a word in a claim that's one of them must be in what was searched."""
    draft = draft or {}
    searched = (stock_search or {}).get("searched_for") or ""
    searched_words = _words(searched)
    known = vehicle_words | {k.replace("-", "") for k in KNOWN_MAKES}
    violations: list[str] = []
    for name, key in (("SMS", "sms_text"), ("email", "email_body")):
        for m in _CLAIM.finditer(str(draft.get(key) or "")):
            said = (m.group("a") or m.group("b") or m.group("c") or "").strip()
            # Only a claim about stock: "I don't have that link handy" / "the details" is not one.
            if not (_EVERYTHING.match(said) or _STOCKY.search(said) or (_words(said) & known)):
                continue
            if stock_search is None:
                violations.append(f"the {name} says we don't have {said!r}, but no stock search ran this turn: "
                                  "say the team will confirm instead")
                continue
            if _EVERYTHING.match(said) and (searched != "any vehicle" or inventory):
                violations.append(f"the {name} says we have no vehicles at all, but this turn only searched for "
                                  f"{searched}: say we don't have {searched} right now, nothing more")
                continue
            named = {w for w in _words(said) if w in known} - searched_words
            if named:
                violations.append(f"the {name} says we don't have {said!r}, but this turn searched for {searched}, "
                                  "not that: only say we don't have what was searched")
    return violations
