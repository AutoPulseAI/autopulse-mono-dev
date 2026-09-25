"""Decide: picks exactly one next step (architecture §8.3). A pure function:
the same profile and the same extraction always give the same answer, which
is what makes slot filling deterministic.

Rules, checked in order; the first that applies wins:
  1. stop       the customer opted out
  2. handoff    they asked for a person, or sound upset
  3. confirm    a value is waiting for confirmation (one at a time)
  4. ask        required slots are missing or stale (at most 2 per message)
  5. qualified  nothing missing: tell the dealer, stop asking

Every rule's result is returned too, so the Debug UI can show why.
"""

from dataclasses import dataclass, field
from typing import Any

from upsell_agent.agent.pipeline import DECIDE_RULES
from upsell_agent.slots.profile import Profile
from upsell_agent.slots.schema import SCHEMA

MAX_ASKS_PER_MESSAGE = 2


@dataclass
class Flags:
    opted_out: bool = False
    wants_human: bool = False
    upset: bool = False
    customer_questions: list[str] = field(default_factory=list)


def next_action(profile: Profile, flags: Flags) -> dict[str, Any]:
    pending = profile.pending()
    missing = profile.missing()
    asks = missing[:MAX_ASKS_PER_MESSAGE]
    filled, total = profile.progress()

    conditions: dict[str, tuple[bool, str]] = {
        "stop": (flags.opted_out, "Customer opted out"),
        "handoff": (flags.wants_human or flags.upset,
                    "Customer asked for a person" if flags.wants_human else "Customer seems upset"),
        "confirm": (bool(pending), f"Confirm {SCHEMA[pending[0].path].label}: {pending[0].value!r}" if pending else ""),
        "ask": (bool(missing), "Missing: " + ", ".join(r.label for r in asks) if missing else ""),
        "qualified": (True, f"All {total} required details collected"),
    }

    rules, fired = [], None
    for rule in DECIDE_RULES:
        hit, why = conditions[rule["id"]]
        if fired is None and hit:
            fired = rule["id"]
            rules.append({"id": rule["id"], "result": "fired", "why": why})
        else:
            rules.append({"id": rule["id"], "result": "skipped" if fired else "no", "why": ""})

    decision: dict[str, Any] = {
        "action": fired,
        "answer_questions": list(flags.customer_questions),
        "rules": rules,
        "required_total": total,
        "required_filled": filled,
        "lead_type": profile.lead_type.value,
        "effective_lead_type": profile.effective_lead_type.value,
        "slots": [],
        "asks": [],
    }
    if fired == "confirm":
        slot = pending[0]
        decision["slots"] = [slot.path]
        decision["confirm"] = {"path": slot.path, "label": SCHEMA[slot.path].label, "value": slot.value,
                               "fact_id": slot.fact_id}
    elif fired == "ask":
        for requirement in asks:
            unfilled = [p for p in requirement.slots if not profile.is_current(p)]
            if requirement.mode == "any":
                unfilled = list(requirement.slots)
            decision["asks"].append({"requirement": requirement.id, "label": requirement.label,
                                     "slots": unfilled, "hint": requirement.ask_hint})
            decision["slots"] += [p for p in unfilled if p not in decision["slots"]]
    return decision
