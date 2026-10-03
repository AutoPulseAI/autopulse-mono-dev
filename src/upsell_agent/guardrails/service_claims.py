"""Guard knowledge for recall and maintenance claims (MASTER_PLAN_4 D5/D6, stream A4).

SOLD-DELIVERED PDF §12: "Never fabricate vehicle data, maintenance, mileage, recall status ..."; §6 "Never claim a
recall without VIN-specific authoritative support" and "Do not represent NHTSA safety recalls as manufacturer
service campaigns"; §5 "never present estimated mileage as known actual mileage" and "Never invent maintenance
requirements"; conversations.md: "Never invent ... service needs".

`facts` are the service outreach event's facts (agent/service_events.py: agent/recalls.py recall_facts,
agent/maintenance.py compute_status). A draft may state only what they hold:
- A recall claim ("a safety recall on your ...", "open recall") needs a VIN-confirmed recall in the facts, and
  any NHTSA campaign number it names must be that recall's. Checked on **every** draft, facts or not: no other
  conversation may claim a recall.
- A "service is due" claim ("due for its 30,000-mile service", "scheduled maintenance") needs maintenance facts.
  Checked on every draft too.
- With maintenance facts: every maintenance item named (oil change, cabin air filter, ...) must be one of the
  schedule's own items; without a verified mileage, the draft must not state the vehicle's mileage.
- "Service campaign" / "manufacturer campaign" wording is rejected when talking about a recall.

`known_values(facts)` lists the numbers the draft may repeat (schedule mileage, verified reading, model year),
for draft_guard's number check.
"""

import re
from typing import Any

_RECALL_CLAIM = re.compile(
    r"\b(?:safety|open|active|outstanding|unrepaired|a|an|the|this|that|your|its)\s+(?:safety\s+)?recalls?\b"
    r"|\brecalls?\s+(?:on|for|notice|repair|campaign|affecting|that affects)\b|\bunder (?:a )?recall\b",
    re.IGNORECASE)
_CAMPAIGN_NUMBER = re.compile(r"\b\d{2}[VEITC]\d{6}\b", re.IGNORECASE)
_SERVICE_CAMPAIGN = re.compile(r"\b(?:service|manufacturer|factory|oem)\s+campaigns?\b", re.IGNORECASE)
_SERVICE_DUE = re.compile(
    r"\b(?:is|are|now|overdue|coming)\s+(?:due|up)\s+for\b|\bdue for (?:its|your|an?|the)\b"
    r"|\bscheduled maintenance\b|\brecommended (?:service|maintenance)\b|\bmaintenance (?:is )?due\b"
    r"|\b[\d,]+k?[- ]mile (?:service|maintenance)\b|\bservice (?:is )?(?:now )?due\b",
    re.IGNORECASE)
# Maintenance words a draft could name. Each must be covered by the schedule's own service items.
_ITEMS: dict[str, tuple[str, ...]] = {
    "oil change": ("oil",), "oil and filter": ("oil",), "engine oil": ("oil",),
    "tire rotation": ("tire", "rotat"), "rotate the tires": ("tire", "rotat"), "rotate your tires": ("tire", "rotat"),
    "brake fluid": ("brake fluid",), "brake pads": ("brake",), "brakes": ("brake",),
    "cabin air filter": ("cabin",), "cabin filter": ("cabin",), "engine air filter": ("air cleaner", "air filter"),
    "air filter": ("air cleaner", "air filter", "cabin"),
    "transmission fluid": ("transmission", "transaxle", "cvt"), "cvt fluid": ("transmission", "transaxle", "cvt"),
    "coolant": ("coolant",), "spark plugs": ("spark plug",), "timing belt": ("timing belt",),
    "wiper blades": ("wiper",), "battery": ("battery",), "alignment": ("alignment",),
    "differential fluid": ("differential",), "fuel filter": ("fuel filter",), "serpentine belt": ("belt",),
}
_ITEM_PATTERN = re.compile(r"\b(?:" + "|".join(re.escape(k) for k in sorted(_ITEMS, key=len, reverse=True)) + r")\b",
                           re.IGNORECASE)
_MILEAGE_STATEMENT = re.compile(
    r"\b(?:you(?:'re| are)|your \w+(?: \w+)? (?:has|is at|is now at|should be at|is probably at|has about))"
    r"[^.!?]{0,30}?\b[\d,]+k?\s*miles\b"
    r"|\b(?:about|around|roughly|approximately|probably|estimated)\s+[\d,]+k?\s*miles\b",
    re.IGNORECASE)


def _covered(word: str, items: list[str]) -> bool:
    keys = _ITEMS.get(word.lower(), (word.lower(),))
    return any(k in item.lower() for item in items for k in keys)


def check_service_claims(text: str, facts: dict[str, Any] | None) -> list[str]:
    """Violations, empty when the draft states only what `facts` support."""
    facts = facts or {}
    kind = facts.get("kind")
    violations: list[str] = []

    recall_ok = kind == "recall" and facts.get("vin_confirmed") is True
    if _RECALL_CLAIM.search(text) and not recall_ok:
        violations.append("claims a recall with no VIN-confirmed recall behind this message")
    named = {m.upper() for m in _CAMPAIGN_NUMBER.findall(text)}
    allowed = {str(facts.get("recall_id") or "").upper()} if recall_ok else set()
    if bad := sorted(named - allowed):
        violations.append(f"names a recall number not in this message's facts: {', '.join(bad)}")
    if kind == "recall" and _SERVICE_CAMPAIGN.search(text):
        violations.append("calls an NHTSA safety recall a service/manufacturer campaign")

    if _SERVICE_DUE.search(text) and kind != "maintenance":
        violations.append("says a service is due with no maintenance schedule behind this message")
    if kind == "maintenance":
        items = [str(i) for i in facts.get("service_items") or []]
        invented = sorted({m.group(0).lower() for m in _ITEM_PATTERN.finditer(text) if not _covered(m.group(0), items)})
        if invented:
            violations.append(f"maintenance items not in the OEM schedule for this service: {', '.join(invented)}")
        if not facts.get("verified_mileage") and _MILEAGE_STATEMENT.search(text):
            violations.append("states the vehicle's mileage, but there is no verified current reading")
    return violations


def known_values(facts: dict[str, Any] | None) -> list[Any]:
    """Numbers the draft may repeat from the facts."""
    facts = facts or {}
    values: list[Any] = [facts.get("year"), facts.get("interval_miles"),
                         (facts.get("verified_mileage") or {}).get("miles"), facts.get("months_since_last_visit"),
                         facts.get("last_visit_date")]
    return [v for v in values if v is not None]
