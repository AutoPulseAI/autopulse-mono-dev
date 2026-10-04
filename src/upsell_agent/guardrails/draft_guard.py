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

from upsell_agent.agent.media import unattached_photo_claim
from upsell_agent.guardrails import service_claims, word_claims
from upsell_agent.guardrails.consent_claims import consent_claims
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
# MASTER_PLAN_3 C4 (decision 152): the client's required Touch 1 opening alone is about 190 characters,
# so the first reply to a new lead may use three SMS segments instead of two.
TOUCH1_SMS_MAX = 480

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
        # "3pm" / "10am" read as a model-name token above (stream Q: a reply repeating the customer's "3pm" as
        # "3:00 PM" was rejected as an invented 3), so a clock time's own numbers are added here.
        for hour, minute in re.findall(r"\b(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)\b", str(text), re.IGNORECASE):
            found.add(_normalize_number(hour))
            if minute:
                found.add(_normalize_number(minute))
        # A clock time typed without a colon ("early like 730", "1030"): its hour and minutes.
        for hour, minute in re.findall(r"(?<![\d$,.])(1[0-2]|[1-9])([0-5]\d)(?![\d,.])", str(text)):
            if minute in ("00", "15", "30", "45"):
                found.update({_normalize_number(hour), _normalize_number(minute)})
    return found


def _mentioned(draft: dict[str, Any], inventory: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The loaded records this draft actually names, via sms_vins/email_vins."""
    by_vin = {r["vin"]: r for r in inventory if r.get("vin")}
    vins = {*(draft.get("sms_vins") or []), *(draft.get("email_vins") or [])}
    return [by_vin[v] for v in vins if v in by_vin]


def _named_by_model(text: str, inventory: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Loaded records whose model the text names (whole word), vin or not."""
    return [r for r in inventory if (model := str(r.get("model") or "").strip())
            and re.search(rf"(?<![\w-]){re.escape(model)}(?![\w-])", text, re.IGNORECASE)]


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
                inventory: list[dict[str, Any]] | None = None, sms_max: int = SMS_MAX,
                media_attached: bool = False, service_facts: dict[str, Any] | None = None) -> dict[str, Any]:
    if not draft:
        return {"passed": False, "checks": {"draft_present": False}, "violations": ["no draft to check"]}

    sms, subject, body = draft.get("sms_text") or "", draft.get("email_subject") or "", draft.get("email_body") or ""
    text = f"{sms}\n{subject}\n{body}"
    # A named vehicle's own year/miles are allowed numbers too (MASTER_PLAN_3
    # Phase 3 decision C): they came from a record this draft actually named,
    # not invented.
    vehicle_facts = [r[k] for r in _mentioned(draft, inventory or []) for k in ("year", "miles") if r.get(k) is not None]
    # Stream Q: a follow-up that names a vehicle from this turn's stock by model without listing its vin again
    # ("that 2022 Toyota RAV4 XLE in blue has 31,200 miles", answering "What's the mileage on it?") is still
    # quoting that record's own year and miles: allowed, not invented.
    vehicle_facts += [r[k] for r in _named_by_model(text, inventory or []) for k in ("year", "miles")
                      if r.get(k) is not None]
    # PLAN_4 stream L (architecture §15 decision 14's exception): a verified price drop's own prices, only for
    # that vehicle and only when the draft names it. Only a price-drop cadence touch's record carries one.
    vehicle_facts += [v for r in _mentioned(draft, inventory or []) for v in (r.get("price_drop") or {}).values()
                      if isinstance(v, (int, float)) and not isinstance(v, bool)]
    # MASTER_PLAN_4 D5/D6 (stream A4): a service outreach may repeat its own facts' numbers.
    allowed = _numbers([*customer_texts, *known_values, *vehicle_facts, *service_claims.known_values(service_facts)])
    violations: list[str] = []

    # "30,000-mile service": the hyphenated "000-mile" would otherwise read as a model name and leave "30,".
    invented = sorted({raw for raw in _claims(re.sub(r"(\d)-(mile)", r"\1 \2", text, flags=re.IGNORECASE))
                       if (n := _normalize_number(raw)) != "0" and n not in allowed})
    if invented:
        violations.append(f"numbers the customer never gave us: {', '.join(invented)}")

    approval = [p for p in _APPROVAL_LANGUAGE_PATTERNS if re.search(p, text, re.IGNORECASE)]
    if approval:
        violations.append("approval or guarantee language")

    grounding, per_vehicle = _grounding(text, draft, inventory or [])
    violations += grounding

    # MASTER_PLAN_3 C6: never claim a photo that isn't attached (nothing is attached until Plan 4 F3).
    photo_claims = unattached_photo_claim(text, media_attached=media_attached)
    violations += photo_claims

    # MASTER_PLAN_4 D5/D6 (stream A4): recall / maintenance claims only from the outreach event's facts
    # (SOLD-DELIVERED PDF §5, §6, §12). Recall and "service due" claims are checked on every draft.
    service = service_claims.check_service_claims(
        text, service_facts, customer_said_recall=any(re.search(r"\brecall", t or "", re.IGNORECASE)
                                                      for t in customer_texts))
    violations += service

    # PLAN_4 stream X1 item 9 (TCPA PDF §10): never state or infer consent, eligibility or contactability.
    consent_said = consent_claims(text)
    if consent_said:
        violations.append(f"states the customer's consent or eligibility: {', '.join(consent_said)}")
    # PLAN_4 stream X3 item 9: durations, dealer process / policy and "Yes - the team will confirm whether ..."
    # written in words.
    words = word_claims.check(text, customer_texts)
    violations += words

    checks = {
        "no_consent_claims": not consent_said,
        "no_invented_numbers": not invented,
        "no_approval_language": not approval,
        "grounded_in_real_stock": not grounding,
        "no_unattached_photo_claims": not photo_claims,
        "service_claims_grounded": not service,
        "no_invented_word_claims": not words,
        "sms_length_ok": 0 < len(sms) <= sms_max,
        "email_complete": bool(subject.strip()) and bool(body.strip()),
    }
    if not checks["sms_length_ok"]:
        violations.append(f"SMS must be 1-{sms_max} characters (is {len(sms)})")
    if not checks["email_complete"]:
        violations.append("email needs a subject and a body")
    result = {"passed": all(checks.values()), "checks": checks, "violations": violations}
    if per_vehicle:  # MASTER_PLAN_3 Phase 6 item 2: shown in the Debug UI's Guard step
        result["per_vehicle"] = per_vehicle
    return result
