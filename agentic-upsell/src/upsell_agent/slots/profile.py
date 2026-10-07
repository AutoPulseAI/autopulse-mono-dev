"""The customer's profile as the pipeline sees it: every slot's current value
and state, built from qualification_facts (architecture §8, MASTER_PLAN_1
Stage 7).

States:
- filled            current and trusted
- needs_confirming  extracted with low confidence; asked about next
- stale             older than the slot's staleness period; counts as missing
- missing           a required slot with no current value
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from upsell_agent import clock
from upsell_agent.agent.qualification import LeadType
from upsell_agent.slots.display import display_value
from upsell_agent.slots.requirements import Requirement, effective_lead_type, required_for
from upsell_agent.slots.schema import GROUP_LABELS, GROUP_ORDER, SCHEMA

SlotState = Literal["filled", "needs_confirming", "stale", "missing"]


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


@dataclass
class SlotValue:
    path: str
    value: Any
    state: SlotState
    source: str
    fact_id: str
    source_message_id: str | None = None
    quote: str | None = None
    confidence: float | None = None
    captured_at: datetime | None = None
    history: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Profile:
    lead_type: LeadType
    slots: dict[str, SlotValue]

    def values(self, *, include_stale: bool = False) -> dict[str, Any]:
        """Current values usable for decisions (no pending ones)."""
        ok = {"filled", "stale"} if include_stale else {"filled"}
        return {p: s.value for p, s in self.slots.items() if s.state in ok}

    def is_current(self, path: str) -> bool:
        slot = self.slots.get(path)
        return bool(slot and slot.state == "filled")

    def satisfied(self, requirement: Requirement) -> bool:
        checks = [self.is_current(p) for p in requirement.slots]
        return any(checks) if requirement.mode == "any" else all(checks)

    @property
    def effective_lead_type(self) -> LeadType:
        return effective_lead_type(self.lead_type, self.values())

    def requirements(self) -> list[Requirement]:
        return required_for(self.lead_type, self.values())

    def missing(self) -> list[Requirement]:
        return sorted((r for r in self.requirements() if not self.satisfied(r)), key=lambda r: r.priority)

    def pending(self) -> list[SlotValue]:
        waiting = [s for s in self.slots.values() if s.state == "needs_confirming"]
        return sorted(waiting, key=lambda s: SCHEMA[s.path].priority or 999)

    def progress(self) -> tuple[int, int]:
        requirements = self.requirements()
        return sum(1 for r in requirements if self.satisfied(r)), len(requirements)

    def summary(self) -> dict[str, Any]:
        """Compact view for prompts: current values only."""
        return {p: s.value for p, s in sorted(self.slots.items()) if s.state in ("filled", "stale")}

    def to_api(self) -> dict[str, Any]:
        """Shape used by GET /v1/leads/{id}/profile and the Debug UI (FPLAN
        "Fields you can rely on")."""
        missing_paths: list[str] = []
        for requirement in self.missing():
            missing_paths += [p for p in requirement.slots if not self.is_current(p) and p not in missing_paths]
        rows = [
            {"path": s.path, "label": SCHEMA[s.path].label, "group": SCHEMA[s.path].group, "value": s.value,
             "display": display_value(SCHEMA[s.path], s.value), "state": s.state, "source": "platform" if s.source == "tool_verified" else "customer",
             "source_message_id": s.source_message_id, "quote": s.quote, "confidence": s.confidence,
             "captured_at": s.captured_at.isoformat() if s.captured_at else None, "history": s.history}
            for s in self.slots.values()
        ] + [
            {"path": p, "label": SCHEMA[p].label, "group": SCHEMA[p].group, "value": None, "display": "",
             "state": "missing",
             "source": None, "source_message_id": None, "quote": None, "confidence": None, "captured_at": None,
             "history": []}
            for p in missing_paths if p not in self.slots
        ]
        rows.sort(key=lambda r: (GROUP_ORDER.index(r["group"]), SCHEMA[r["path"]].priority or 999, r["path"]))
        filled, total = self.progress()
        return {
            "lead_type": self.lead_type.value,
            "effective_lead_type": self.effective_lead_type.value,
            "slots": rows,
            "groups": [{"id": g, "label": GROUP_LABELS[g]} for g in GROUP_ORDER],
            "missing": [{"id": r.id, "label": r.label, "slots": list(r.slots)} for r in self.missing()],
            "required": {"filled": filled, "total": total},
        }


def build_profile(lead_type: LeadType, current: list[dict], history: list[dict] | None = None,
                  now: datetime | None = None) -> Profile:
    now = now or clock.now()
    past: dict[str, list[dict]] = {}
    for fact in sorted(history or [], key=lambda f: _aware(f.get("valid_from")) or now):
        past.setdefault(fact["path"], []).append({
            "value": fact.get("value"), "source": fact.get("source"),
            "valid_from": (_aware(fact.get("valid_from")) or now).isoformat(),
            "valid_to": (_aware(fact.get("valid_to")) or now).isoformat(),
            "rejected": bool(fact.get("rejected")),
        })

    slots: dict[str, SlotValue] = {}
    for fact in current:
        defn = SCHEMA.get(fact["path"])
        if defn is None:
            continue  # a slot that was removed from the schema
        observed = _aware(fact.get("observed_at") or fact.get("valid_from")) or now
        if fact.get("pending"):
            state: SlotState = "needs_confirming"
        elif defn.staleness is not None and now - observed > defn.staleness:
            state = "stale"
        else:
            state = "filled"
        slots[fact["path"]] = SlotValue(
            path=fact["path"], value=fact.get("value"), state=state, source=fact.get("source", ""),
            fact_id=str(fact["_id"]), source_message_id=fact.get("source_message_id"), quote=fact.get("quote"),
            confidence=fact.get("confidence"), captured_at=_aware(fact.get("valid_from")),
            history=past.get(fact["path"], []),
        )
    return Profile(lead_type=lead_type, slots=slots)
