"""Enforces conversations.md's single non-negotiable rule, verbatim:

    "Never invent information, approvals, pricing, trade values, availability,
    or service needs."

This is a DIFFERENT check from guardrails/output_validation.py's tool-result
grounding (built for the single-shot product-recommendation flow). This one
governs the qualification conversation's ADVANCE/LEVERAGE output and applies a
stricter, two-tier rule per conversations.md's own examples:

1. APPROVAL, PRICING, TRADE_VALUE, AVAILABILITY — the agent must NEVER state a
   real number/decision for these, even if a tool could technically supply
   one. The only numbers the agent may say back for these categories are
   numbers the CUSTOMER already stated this conversation — reflecting the
   customer's own words back to them, never generating a new one. Enforced
   here as: every dollar figure or count in the offer's value_proposition text
   must match a CapturedFact with source == CUSTOMER_STATED, or it's a
   violation.
2. Approval-language patterns ("you're approved", "you qualify for",
   "guaranteed") are flagged regardless of whether a number is attached —
   conversations.md's failure examples show this can be a violation even
   without a specific number ("we work with all types of credit" implies an
   outcome without stating one).

This first pass is deterministic (regex/keyword matching against
state.captured_facts), matching the same "cheapest, most-reliable-first"
philosophy as guardrails/output_validation.py. A semantic/LLM-assisted second
pass is a documented next step (see the module-level TODO below), not
something to add before evals show the deterministic pass is insufficient —
see evals/test_hallucination.py.

TODO (semantic pass, once evals show the deterministic pass misses cases):
    - a cheap model call asking "does this text assert anything about
      approval, price, trade value, availability or service need that isn't
      directly traceable to the provided captured facts?" — catches phrasing
      that implies a claim without a matching number (e.g. "that should work
      out fine for you" as an implied approval).
"""

import re

from upsell_agent.agent.qualification import FactSource
from upsell_agent.agent.state import AgentState

# Deliberately broad and over-inclusive — a false-positive violation (a safe
# sentence gets flagged and regenerated) is cheap; a false negative (a
# hallucinated approval reaches a customer) is the exact failure this module
# exists to prevent. Tune down only if evals show real sentences getting
# rejected too often, never the other direction.
_APPROVAL_LANGUAGE_PATTERNS = [
    r"\byou'?re approved\b",
    r"\byou (?:will|should) (?:be approved|qualify)\b",
    r"\bguarantee(?:d)?\b",
    r"\bwe can (?:definitely|certainly) get you\b",
    r"\bapproval is\b",
]

# Matches dollar amounts ($9,000 / $9000 / $9,000.00) and bare large integers
# that read as currency in context (9000, 82,000) — intentionally broad; a
# false-positive match against a non-financial number (e.g. "60,000-mile
# service") is filtered separately by the service-need exemption in
# check_appointment_offer, not by narrowing this pattern.
_NUMERIC_CLAIM_PATTERN = re.compile(r"\$?\d[\d,]*(?:\.\d+)?")


def _normalize_number(raw: str) -> str:
    return raw.replace("$", "").replace(",", "").rstrip("0").rstrip(".") or "0"


def _customer_stated_numeric_strings(state: AgentState) -> set[str]:
    values: set[str] = set()
    for fact in state.captured_facts.values():
        if fact.source != FactSource.CUSTOMER_STATED:
            continue
        if isinstance(fact.value, (int, float)):
            values.add(_normalize_number(str(fact.value)))
        elif isinstance(fact.value, str):
            for match in _NUMERIC_CLAIM_PATTERN.findall(fact.value):
                values.add(_normalize_number(match))
    return values


def check_appointment_offer(state: AgentState) -> list[str]:
    """Returns a list of human-readable violation descriptions. Empty list
    means the offer is safe to send. Called from the ADVANCE-stage node before
    any customer-facing text is sent — never after.
    """
    if state.appointment_offer is None:
        return []

    text = state.appointment_offer.value_proposition
    violations: list[str] = []

    for pattern in _APPROVAL_LANGUAGE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            violations.append(
                f"Approval-implying language matched pattern {pattern!r} in value_proposition: {text!r}"
            )

    known_numbers = _customer_stated_numeric_strings(state)
    for raw_match in _NUMERIC_CLAIM_PATTERN.findall(text):
        normalized = _normalize_number(raw_match)
        if normalized == "0":
            continue  # not a meaningful numeric claim (e.g. stray digit)
        if normalized not in known_numbers:
            violations.append(
                f"Numeric claim {raw_match!r} in value_proposition does not match any "
                f"customer-stated captured fact: {text!r}"
            )

    return violations
