"""Guard: checks a drafted reply before it can be sent (architecture §7,
MASTER_PLAN_1 Stage 8; grounding is MASTER_PLAN_3 Phase 4). Plain code, same
result every time.

A draft fails when it:
- states a number the customer never gave us (price, payment, trade value,
  discount - conversations.md: "never invent pricing, trade values,
  availability or approvals"), or a vehicle's year/miles not from a record
  it actually named this turn;
- implies approval or makes a guarantee;
- claims a vehicle is in stock / available with no real vehicle behind it,
  or names a VIN, make or trim that isn't in this turn's loaded stock;
- says a vehicle isn't available with no alternative offered and no promise
  made (a bare "no" - MASTER_PLAN_3 Phase 3 decision D);
- names more vehicles than the channel allows (SMS 2, email 3);
- breaks the channel format (SMS over 320 characters, empty email).

Allowed numbers: those in the customer's own messages this conversation,
slot values the customer stated or the platform verified (e.g. their car's
year), the dealer's own campaign text when replying to a campaign, and a
mentioned vehicle's own year/miles (guard.py adds these to known_values from
`inventory` + `sms_vins`/`email_vins`, so this file needs no vehicle-specific
number logic of its own).

Model names are not numbers: a digit joined to letters (RAV4, CX-5, F-150,
4Runner, 2nd) is part of a name, so it is ignored. "30k" / "60k" are
amounts and are checked (the burst test found every "RAV4" campaign reply
failing the guard, MASTER_PLAN_1 Stage 12).
"""

import re
from collections.abc import Iterable
from typing import Any

from upsell_agent.guardrails.never_invent import _APPROVAL_LANGUAGE_PATTERNS
from upsell_agent.tools.inventory_tool import KNOWN_MAKES, TRIM_WORDS

# Architecture decision 16: SMS names at most 2 vehicles (of at most 3 loaded);
# email names at most 3.
SMS_MAX_VEHICLES = 2
EMAIL_MAX_VEHICLES = 3

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
# MASTER_PLAN_3 Phase 3 decision D: a plain denial is only allowed alongside
# an alternative vehicle or a promise, never on its own. Scoped to stock
# wording specifically, so it never catches unrelated denials (e.g. "I don't
# have any details from you yet.", an about_me answer with an empty profile).
_UNAVAILABLE_PATTERNS = [
    r"\bdon'?t have (?:that |one |any )?(?:in stock|available)\b",
    r"\bdo not have (?:that |one |any )?(?:in stock|available)\b",
    r"\bnot in stock\b", r"\bnone (?:in stock|available)\b",
    r"\bnot available\b", r"\bsold out\b", r"\bno longer available\b",
]
_TRIM_WORD = re.compile("|".join(rf"\b{re.escape(w)}\b" for w in sorted(TRIM_WORDS, key=len, reverse=True)),
                        re.IGNORECASE)


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


def _mentioned(draft: dict[str, Any], inventory: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The loaded records this draft actually names, via sms_vins/email_vins."""
    by_vin = {r["vin"]: r for r in inventory if r.get("vin")}
    vins = {*(draft.get("sms_vins") or []), *(draft.get("email_vins") or [])}
    return [by_vin[v] for v in vins if v in by_vin]


def _grounding(text: str, draft: dict[str, Any], inventory: list[dict[str, Any]]) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """MASTER_PLAN_3 Phase 4: every vehicle the draft names must be real stock
    loaded this turn, described only with that record's own fields.

    Returns the overall violation messages, and `per_vehicle`: one entry per
    VIN this draft actually named (MASTER_PLAN_3 Phase 6 item 2, for the
    Debug UI), each `{ok, problems}`. A bad trim or make can't be pinned to a
    specific one of several named vehicles from the text alone, so it's
    recorded against every vehicle named on that version (SMS or email) - an
    approximation, not a per-word attribution."""
    violations: list[str] = []
    by_vin = {r["vin"]: r for r in inventory if r.get("vin")}
    sms_vins, email_vins = list(draft.get("sms_vins") or []), list(draft.get("email_vins") or [])
    all_vins = [*sms_vins, *email_vins]
    per_vehicle: dict[str, dict[str, Any]] = {v: {"ok": True, "problems": []} for v in dict.fromkeys(all_vins)}

    if len(sms_vins) > SMS_MAX_VEHICLES:
        violations.append(f"names {len(sms_vins)} vehicles by SMS (at most {SMS_MAX_VEHICLES})")
    if len(email_vins) > EMAIL_MAX_VEHICLES:
        violations.append(f"names {len(email_vins)} vehicles by email (at most {EMAIL_MAX_VEHICLES})")

    unknown = sorted({v for v in all_vins if v not in by_vin})
    if unknown:
        violations.append(f"vehicle(s) not in this turn's stock: {', '.join(unknown)}")
        for v in unknown:
            per_vehicle[v]["ok"] = False
            per_vehicle[v]["problems"].append("not in this turn's stock")

    mentioned = _mentioned(draft, inventory)

    # Only checked when the draft claims to be naming stock at all (sms_vins/
    # email_vins non-empty). A make/trim word with no vins named is left to
    # the customer's-own-car case (their trade-in or current vehicle, echoed
    # back in plain words) - protected separately by the availability check
    # below, which still catches a model dodging vins while claiming stock.
    if sms_vins or email_vins:
        trim_words = {w.group(0).lower() for w in _TRIM_WORD.finditer(text)}
        have_trims = {t for r in mentioned if (t := (r.get("trim") or "").lower())}
        bad_trims = sorted(w for w in trim_words if not any(w in have for have in have_trims))
        if bad_trims:
            violations.append(f"a trim not on the named vehicle(s): {', '.join(bad_trims)}")
            for v, info in per_vehicle.items():
                if v in by_vin:
                    info["ok"] = False
                    info["problems"].append(f"trim not on this vehicle: {', '.join(bad_trims)}")

        have_makes = {(r.get("make") or "").lower() for r in mentioned}
        named_makes = {m.lower() for m in KNOWN_MAKES.values()
                       if re.search(rf"\b{re.escape(m)}\b", text, re.IGNORECASE)}
        bad_makes = sorted(m for m in named_makes if m not in have_makes)
        if bad_makes:
            violations.append(f"a make not on the named vehicle(s): {', '.join(bad_makes)}")
            for v, info in per_vehicle.items():
                if v in by_vin:
                    info["ok"] = False
                    info["problems"].append(f"make not on this vehicle: {', '.join(bad_makes)}")

    # "we don't have that in stock" contains the same words as an affirmative
    # "it's in stock" claim, so a denial's own wording must never also trip
    # the availability check: matches that overlap a recognized denial are
    # excluded there and left to the unavailable-wording rule below instead.
    unavailable_spans = [m.span() for p in _UNAVAILABLE_PATTERNS for m in re.finditer(p, text, re.IGNORECASE)]
    availability = [m for p in _AVAILABILITY_PATTERNS for m in re.finditer(p, text, re.IGNORECASE)
                   if not any(m.start() < e and s < m.end() for s, e in unavailable_spans)]
    if availability and not mentioned:
        violations.append("claims a vehicle is available / in stock without naming a real one from this turn's stock")

    if unavailable_spans and not mentioned and not (draft.get("promises") or []):
        violations.append("says a vehicle isn't available with no alternative offered and no promise made")

    return violations, per_vehicle


def check_draft(draft: dict[str, Any] | None, *, customer_texts: list[str], known_values: Iterable[Any],
                inventory: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if not draft:
        return {"passed": False, "checks": {"draft_present": False}, "violations": ["no draft to check"]}

    sms, subject, body = draft.get("sms_text") or "", draft.get("email_subject") or "", draft.get("email_body") or ""
    text = f"{sms}\n{subject}\n{body}"
    # A named vehicle's own year/miles are allowed numbers too (MASTER_PLAN_3
    # Phase 3 decision C): they came from a record this draft actually named,
    # not invented.
    vehicle_facts = [r[k] for r in _mentioned(draft, inventory or []) for k in ("year", "miles") if r.get(k) is not None]
    allowed = _numbers([*customer_texts, *known_values, *vehicle_facts])
    violations: list[str] = []

    invented = sorted({raw for raw in _claims(text)
                       if (n := _normalize_number(raw)) != "0" and n not in allowed})
    if invented:
        violations.append(f"numbers the customer never gave us: {', '.join(invented)}")

    approval = [p for p in _APPROVAL_LANGUAGE_PATTERNS if re.search(p, text, re.IGNORECASE)]
    if approval:
        violations.append("approval or guarantee language")

    grounding, per_vehicle = _grounding(text, draft, inventory or [])
    violations += grounding

    checks = {
        "no_invented_numbers": not invented,
        "no_approval_language": not approval,
        "grounded_in_real_stock": not grounding,
        "sms_length_ok": 0 < len(sms) <= SMS_MAX,
        "email_complete": bool(subject.strip()) and bool(body.strip()),
    }
    if not checks["sms_length_ok"]:
        violations.append(f"SMS must be 1-{SMS_MAX} characters (is {len(sms)})")
    if not checks["email_complete"]:
        violations.append("email needs a subject and a body")
    result = {"passed": all(checks.values()), "checks": checks, "violations": violations}
    if per_vehicle:  # MASTER_PLAN_3 Phase 6 item 2: shown in the Debug UI's Guard step
        result["per_vehicle"] = per_vehicle
    return result
