"""What must be collected before a lead counts as qualified (architecture
§8.2), and how a lead's type is decided.

A requirement is one thing to ask about. Most are a single slot; "trade
vehicle" needs year, make and model together; "budget" is satisfied by a
budget OR a monthly payment.
"""

import re
from dataclasses import dataclass
from typing import Literal

from upsell_agent.agent.qualification import LeadType
from upsell_agent.slots.schema import SCHEMA


@dataclass(frozen=True)
class Requirement:
    id: str
    label: str
    slots: tuple[str, ...]
    mode: Literal["all", "any"] = "all"

    @property
    def priority(self) -> int:
        return min(SCHEMA[path].priority or 999 for path in self.slots)

    @property
    def ask_hint(self) -> str:
        return SCHEMA[self.slots[0]].ask_hint


def _single(path: str) -> Requirement:
    return Requirement(path, SCHEMA[path].label, (path,))


TRADE_IN_REQUIREMENTS = [
    Requirement("trade_in.vehicle", "Trade-in vehicle", ("trade_in.year", "trade_in.make", "trade_in.model")),
    _single("trade_in.mileage"),
    _single("trade_in.condition"),
    _single("trade_in.payoff"),
]

REQUIRED_BY_LEAD_TYPE: dict[LeadType, list[Requirement]] = {
    LeadType.SALES: [
        _single("interest.new_or_used"),
        _single("interest.model"),
        Requirement("interest.budget_or_payment", "Budget or monthly payment",
                    ("interest.budget", "interest.monthly_payment"), mode="any"),
        _single("interest.timeline"),
        _single("trade_in.has_trade"),
    ],
    LeadType.TRADE_IN: TRADE_IN_REQUIREMENTS,
    LeadType.SERVICE: [
        Requirement("vehicle.vehicle", "Vehicle", ("vehicle.year", "vehicle.make", "vehicle.model")),
        _single("vehicle.mileage"),
        _single("interest.service_needed"),
        _single("contact.best_time"),
    ],
    LeadType.GENERAL: [_single("interest.lead_type")],
}


def required_for(lead_type: LeadType, values: dict[str, object]) -> list[Requirement]:
    """The requirements that apply now. `values` are the current slot values:
    a general lead that told us why it's here takes that type's list, and a
    sales lead with a trade also needs the trade-in details."""
    effective = lead_type
    if lead_type == LeadType.GENERAL and values.get("interest.lead_type") in LeadType._value2member_map_:
        effective = LeadType(values["interest.lead_type"])
    requirements = list(REQUIRED_BY_LEAD_TYPE[effective])
    if effective == LeadType.SALES and values.get("trade_in.has_trade") is True:
        requirements += TRADE_IN_REQUIREMENTS
    return requirements


def effective_lead_type(lead_type: LeadType, values: dict[str, object]) -> LeadType:
    if lead_type == LeadType.GENERAL and values.get("interest.lead_type") in LeadType._value2member_map_:
        return LeadType(values["interest.lead_type"])
    return lead_type


# --- Lead type from the platform lead ---------------------------------------------
#
# Source buckets from the client blueprint (docs/client/autpulse.workflowblueprint.png):
# credit / finance sources and general marketplaces are sales conversations;
# "sell my car" / valuation sources are trade-ins. Checked in order; first match wins.
LEAD_SOURCE_TO_TYPE: list[tuple[str, LeadType]] = [
    (r"sell\s*my\s*car|trade|kbb|kelley|accutrade|instant\s*offer|valuation|appraisal", LeadType.TRADE_IN),
    (r"service|repair|maintenance|oil|appointment|recall", LeadType.SERVICE),
    (r"credit|financ|capital\s*one|700credit|carzing|dealercentric|eunifi|pre-?qual|approval",
     LeadType.SALES),
    ((r"cargurus|autotrader|edmunds|cars\.com|truecar|carsdirect|facebook|instagram|autoweb|website|"
      r"inventory|vdp|test\s*drive|sales|showroom"), LeadType.SALES),
]


def lead_type_for(lead: dict | None) -> LeadType:
    """Lead type set in code from the lead (architecture §8.2): an explicit
    type on the lead wins, then the source mapping above; anything else is
    `general` and the AI asks."""
    if not lead:
        return LeadType.GENERAL
    explicit = (lead.get("data") or {}).get("lead_type") or lead.get("lead_type")
    if explicit in LeadType._value2member_map_:
        return LeadType(explicit)
    source = " ".join(str(lead.get(k) or "") for k in ("source", "lead_source")).lower()
    for pattern, lead_type in LEAD_SOURCE_TO_TYPE:
        if re.search(pattern, source):
            return lead_type
    return LeadType.GENERAL
