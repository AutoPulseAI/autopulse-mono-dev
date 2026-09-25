"""Guard: checks a drafted reply before it can be sent (architecture §7,
MASTER_PLAN_1 Stage 8). Plain code, same result every time.

A draft fails when it:
- states a number the customer never gave us (price, payment, trade value,
  discount - conversations.md: "never invent pricing, trade values,
  availability or approvals");
- implies approval or makes a guarantee;
- claims a vehicle is in stock / available;
- breaks the channel format (SMS over 320 characters, empty email).

Allowed numbers: those in the customer's own messages this conversation,
slot values the customer stated or the platform verified (e.g. their car's
year), and the dealer's own campaign text when replying to a campaign.

Model names are not numbers: a digit joined to letters (RAV4, CX-5, F-150,
4Runner, 2nd) is part of a name, so it is ignored. "30k" / "60k" are
amounts and are checked (the burst test found every "RAV4" campaign reply
failing the guard, MASTER_PLAN_1 Stage 12).
"""

import re
from collections.abc import Iterable
from typing import Any

from upsell_agent.guardrails.never_invent import _APPROVAL_LANGUAGE_PATTERNS

# A number: optional $, digits with thousands commas, optional decimals,
# optional "k" for thousands.
_NUMBER = re.compile(r"\$?\d[\d,]*(?:\.\d+)?(?:k\b)?", re.IGNORECASE)
# A token mixing letters and digits (RAV4, CX-5, F-150, 4Runner, 2nd) that is
# not an amount shorthand like 30k / 1.5k.
_MODEL_TOKEN = re.compile(r"(?<![\w$])(?=[\w-]*[A-Za-z])(?=[\w-]*\d)(?!\d+(?:\.\d+)?k\b)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*",
                          re.IGNORECASE)


def _normalize_number(raw: str) -> str:
    """"$30,000" -> "30000", "30k" -> "30000", "4.50" -> "4.5", "35.0" -> "35"."""
    value = raw.replace("$", "").replace(",", "").rstrip(".")
    if value[-1:] in ("k", "K"):
        value = f"{float(value[:-1]) * 1000:.2f}"
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return value.lstrip("0") or "0"


def _claims(text: str) -> list[str]:
    """Every number in the text that isn't part of a model name."""
    return _NUMBER.findall(_MODEL_TOKEN.sub(" ", text))


SMS_MAX = 320

_AVAILABILITY_PATTERNS = [
    r"\bin stock\b",
    r"\bstill available\b",
    r"\bon (?:the|our) lot\b",
    r"\bwe have (?:it|one|them|that one) (?:ready|available|here)\b",
]


def _numbers(texts: Iterable[Any]) -> set[str]:
    found: set[str] = set()
    for text in texts:
        if isinstance(text, bool) or text is None:
            continue
        # "60k" and "60,000" normalize to the same value (_normalize_number).
        # "60 k" (with a space) too, so the draft can say 60,000.
        for raw in _claims(str(text)):
            found.add(_normalize_number(raw))
        for kilo in re.findall(r"(\d+(?:\.\d+)?)\s+k\b", str(text), re.IGNORECASE):
            found.add(_normalize_number(f"{kilo}k"))
    return found


def check_draft(draft: dict[str, Any] | None, *, customer_texts: list[str],
                known_values: Iterable[Any]) -> dict[str, Any]:
    if not draft:
        return {"passed": False, "checks": {"draft_present": False}, "violations": ["no draft to check"]}

    sms, subject, body = draft.get("sms_text") or "", draft.get("email_subject") or "", draft.get("email_body") or ""
    text = f"{sms}\n{subject}\n{body}"
    allowed = _numbers([*customer_texts, *known_values])
    violations: list[str] = []

    invented = sorted({raw for raw in _claims(text)
                       if (n := _normalize_number(raw)) != "0" and n not in allowed})
    if invented:
        violations.append(f"numbers the customer never gave us: {', '.join(invented)}")

    approval = [p for p in _APPROVAL_LANGUAGE_PATTERNS if re.search(p, text, re.IGNORECASE)]
    if approval:
        violations.append("approval or guarantee language")

    availability = [p for p in _AVAILABILITY_PATTERNS if re.search(p, text, re.IGNORECASE)]
    if availability:
        violations.append("claims a vehicle is available / in stock")

    checks = {
        "no_invented_numbers": not invented,
        "no_approval_language": not approval,
        "no_availability_claims": not availability,
        "sms_length_ok": 0 < len(sms) <= SMS_MAX,
        "email_complete": bool(subject.strip()) and bool(body.strip()),
    }
    if not checks["sms_length_ok"]:
        violations.append(f"SMS must be 1-{SMS_MAX} characters (is {len(sms)})")
    if not checks["email_complete"]:
        violations.append("email needs a subject and a body")
    return {"passed": all(checks.values()), "checks": checks, "violations": violations}
