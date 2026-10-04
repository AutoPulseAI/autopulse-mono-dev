"""Wording checks on a drafted reply (PLAN_4 stream Q: conversation quality). Plain code, same result every time,
wired into agent/nodes/guard.py. Each one was seen in the real-model runs (gpt-5-mini, stream E/Q):

- a VIN written into the message ("... 31,200 miles (VIN DEV77104D87E42D2C)"): a VIN means nothing to most
  customers, so it is written only when they asked about it;
- the same vehicle named twice in one sentence ("The 2022 Toyota RAV4 XLE we have is a 2022 Toyota RAV4 XLE,
  used, Blue, 31,200 miles");
- a vehicle feature the stock record doesn't show ("We have a few 3-row options. A 2025 Toyota RAV4 XLE
  Hybrid ..."; "that RAV4 does not have AWD"): the inventory record carries year, make, model, trim, body type,
  color and miles only, so seating, drivetrain and equipment are the team's to confirm (grounding rule);
- a made-up person's name ("this is Alex from the sales team"): only the dealer's own AI agent name (Dealer
  Setup's "Bot Name"), or a name the customer used, may be given.
"""

import re
from collections import Counter
from typing import Any

_VERSIONS = (("SMS", "sms_text"), ("email", "email_body"))

# --- VINs ------------------------------------------------------------------------------------------------

_VIN_ASKED = re.compile(r"\bvin\b|vehicle identification", re.IGNORECASE)


def vin_in_text(draft: dict[str, Any], inventory: list[dict[str, Any]], customer_texts: list[str]) -> list[str]:
    """A stock VIN written in the message when the customer never asked about VINs."""
    if any(_VIN_ASKED.search(t or "") for t in customer_texts):
        return []
    vins = [str(r["vin"]) for r in inventory if r.get("vin")]
    out = []
    for name, key in _VERSIONS:
        text = re.sub(r"https?://\S+", " ", str(draft.get(key) or ""))  # a vehicle page link may hold its VIN
        if any(v.lower() in text.lower() for v in vins) or re.search(r"\bVIN\b", text):
            out.append(f"the {name} writes out a VIN, which the customer didn't ask for: describe the vehicle in "
                       "plain words (year, make, model, color, miles)")
    return out


# --- The same vehicle twice in a sentence ------------------------------------------------------------------

def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def repeated_vehicle_name(draft: dict[str, Any], inventory: list[dict[str, Any]]) -> list[str]:
    """One sentence naming the same stock vehicle (year, model and trim) more times than there are such
    vehicles: "a new 2025 RAV4 XLE Hybrid in white, a new 2025 RAV4 LE in silver" names two different ones."""
    out = []
    names = Counter((str(r.get("year") or ""), str(r.get("model") or ""), str(r.get("trim") or ""))
                    for r in inventory if r.get("model"))
    for name, key in _VERSIONS:
        hit = None
        for sentence in _sentences(str(draft.get(key) or "")):
            for (year, model, trim), stocked in names.items():
                pattern = (rf"\b{re.escape(year)}\b[\w\s-]{{0,20}}?" if year else "") + rf"\b{re.escape(model)}\b"
                pattern += rf"\s+{re.escape(trim)}\b" if trim else ""
                if len(re.findall(pattern, sentence, re.IGNORECASE)) > stocked:
                    hit = (f"the {name} names the {year} {model} twice in one sentence ({sentence.strip()!r}): "
                           "name it once, in natural words")
                    break
            if hit:
                break
        if hit:
            out.append(hit)
    return out


# --- Features the stock record doesn't show ---------------------------------------------------------------

_NUM = r"(?:\d|two|three|five|six|seven|eight|nine)"
_FEATURE = re.compile(
    rf"\b{_NUM}[- ]row\b|\bthird[- ]row\b|\b{_NUM}[- ](?:passenger|seat(?:er|s)?)\b|\bseats? (?:up to )?{_NUM}\b"
    r"|\bseating for\b|\b(?:awd|4wd|4x4|fwd|rwd)\b|\b(?:all|four|front|rear)[- ]wheel[- ]drive\b"
    r"|\b(?:sunroof|moonroof|panoramic roof|leather|heated seats?|cooled seats?|navigation|apple carplay|"
    r"android auto|backup camera|blind[- ]spot|tow(?:ing)? capacity|tow package|v6|v8|turbo(?:charged)?|"
    r"car seats?)\b",
    re.IGNORECASE)
# A sentence that defers the feature to the team, or is about what the customer wants, makes no claim.
_NO_CLAIM = re.compile(
    r"\b(confirm|check|find out|look into|verify|let you know|get back to you|looking for|you need|you want|"
    r"you'?d like|you mentioned|you said|interested in|prefer|important to you|must[- ]have|search|"
    r"keep an eye out|is that|do you|would you|are you)\b|\?\s*$", re.IGNORECASE)


def unverified_features(draft: dict[str, Any], inventory: list[dict[str, Any]]) -> list[str]:
    """Seating, drivetrain or equipment stated as a fact when no named record shows it."""
    on_record = " ".join(str(r.get(k) or "") for r in inventory for k in ("model", "trim", "body_type")).lower()
    out = []
    for name, key in _VERSIONS:
        claims = sorted({m.group(0).lower() for s in _sentences(str(draft.get(key) or "")) if not _NO_CLAIM.search(s)
                         for m in _FEATURE.finditer(s) if m.group(0).lower() not in on_record})
        if claims:
            out.append(f"the {name} states a vehicle feature our stock record doesn't show ({', '.join(claims)}): "
                       "say the team will confirm it instead")
    return out


# --- Names ---------------------------------------------------------------------------------------------

_NAME = r"([A-Z][a-z]{1,15})"
_SELF_INTRO = re.compile(rf"\b(?:[Tt]his is|[Mm]y name is|[Ii]t'?s|I'?m|I am)\s+{_NAME}\b(?!\s+(?:Motors|Auto))")
_TEAM_MEMBER = re.compile(rf"\b{_NAME},?\s+(?:from|with|on|in)\s+(?:the|our)\s+(?:sales|service|finance|business|"
                          r"internet|bdc)\b")
_ASK_FOR = re.compile(rf"\b(?:ask for|named|called|speak with|talk to|reach out to you is|contact is)\s+{_NAME}\b")
_NOT_NAMES = frozenset(re.findall(r"\S+", """
Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August
September October November December Happy Glad Sorry Here Sure Excited Available Not Also Just Still Thanks
Thank Hello Hi Hey Good Great Yes No Okay Ok So The Our We You It They He She This That Toyota Honda Ford
Chevrolet Chevy Jeep Nissan Hyundai Kia Subaru Mazda Tesla Dodge Ram Gmc Buick Cadillac Lexus Acura Bmw Audi
Volkswagen Mercedes Volvo Lincoln Chrysler Mitsubishi Infiniti Genesis Porsche Mini Fiat Land Rover
"""))


def invented_names(draft: dict[str, Any], *, allowed: list[str], customer_texts: list[str]) -> list[str]:
    """A person's name in the message that isn't the dealer's own AI agent name, the dealership's name or the
    customer's, and that the customer never used themselves."""
    ok = set(_NOT_NAMES)
    for text in [*allowed, *customer_texts]:
        ok.update(w.capitalize() for w in re.findall(r"[A-Za-z]+", text or ""))
    out = []
    for name, key in _VERSIONS:
        text = str(draft.get(key) or "")
        found = sorted({m.group(1) for p in (_SELF_INTRO, _TEAM_MEMBER, _ASK_FOR) for m in p.finditer(text)
                        if m.group(1) not in ok})
        if found:
            out.append(f"the {name} gives a person's name that isn't on the dealer's record ({', '.join(found)}): "
                       "never name yourself or a team member unless context.dealer.agent_name is given")
    return out
