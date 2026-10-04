"""Inbound or outbound, per lead (MASTER_PLAN_3 B2, architecture §15
decision 65).

The client wants strict rules on outbound contact (the dealer reaching out)
and not on inbound leads (the customer reaching out). Worked out in this
service, in order:

1. The lead came from a platform campaign (the campaign worker's leads, or a
   `CampaignLead` sent to it) → outbound. Every platform campaign is the
   dealer reaching out; there is no campaign type.
2. The lead's source is a known website form, lead provider, phone-up or a
   customer writing first → inbound.
3. The customer is a DealerVault import (`dealervault_upload`) with no lead
   form of their own → outbound.
4. Anything else → outbound, and the source is marked unmapped so it can be
   reported for the client to classify (principle 3: unknown is strictest).
"""

import re
from dataclasses import dataclass
from typing import Any, Literal

from upsell_agent.agent.campaigns import CAMPAIGN_LEADS_COLLECTION
from upsell_agent.integrations.mongodb import DealerScopedDatabase

Origin = Literal["inbound", "outbound"]

# Lead sources that are the customer reaching out. Checked against the
# lead's `source` and `lead_source`, lower case. `dev-` is the dev
# simulator's website-style leads (devtools/simulate.py).
INBOUND_SOURCES = re.compile(
    r"web\s*site|website|web\s*form|\bweb\b|internet|online|\bform\b|contact|chat|landing|"
    r"autotrader|auto\s*trader|cargurus|car\s*gurus|cars\.com|edmunds|truecar|carsdirect|kbb|kelley|"
    r"autoweb|facebook|instagram|google|marketplace|\badf\b|oem|dealer\s*website|capital\s*one|"
    r"700credit|carzing|dealercentric|eunifi|accutrade|instant\s*offer|"
    r"phone|call|walk[\s-]*in|showroom|\bsms\b|\btext\b|\bemail\b|inbound|^dev-",
)
CAMPAIGN_SOURCES = re.compile(r"^campaign")
DMS_SOURCES = re.compile(r"dealer\s*vault|dealervault|\bdms\b|import|csv|upload|equity|drip|re-?engage")


@dataclass(frozen=True)
class LeadOrigin:
    origin: Origin
    rule: str
    source: str
    unmapped: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {"origin": self.origin, "rule": self.rule, "source": self.source, "unmapped": self.unmapped}


def _source(lead: dict | None) -> str:
    lead = lead or {}
    # Each value once (PLAN_4 stream X1 item 8: the audit row's lead_source reads "website", not "website website").
    values = dict.fromkeys(str(lead.get(k) or "").strip().lower() for k in ("source", "lead_source"))
    return " ".join(v for v in values if v)


def origin_from_records(lead: dict | None, customer: dict | None, *, from_campaign: bool) -> LeadOrigin:
    source = _source(lead)
    if from_campaign or CAMPAIGN_SOURCES.search(source):
        return LeadOrigin("outbound", "the conversation started from a platform campaign", source)
    if source and not DMS_SOURCES.search(source) and INBOUND_SOURCES.search(source):
        return LeadOrigin("inbound", f"lead source {source!r} is the customer reaching out", source)
    if (customer or {}).get("dealervault_upload") is True:
        return LeadOrigin("outbound", "DealerVault contact with no lead form of their own", source)
    if source and DMS_SOURCES.search(source):
        return LeadOrigin("outbound", f"lead source {source!r} is a DMS import or dealer outreach", source)
    return LeadOrigin("outbound", f"lead source {source or '(none)'!r} isn't mapped: treated as outbound",
                      source, unmapped=True)


async def lead_origin(db: DealerScopedDatabase, lead: dict | None, customer: dict | None) -> LeadOrigin:
    from_campaign = False
    if lead and lead.get("_id") is not None:
        from_campaign = await db.collection(CAMPAIGN_LEADS_COLLECTION).count_documents(
            {"lead_id": {"$in": [lead["_id"], str(lead["_id"])]}, "status": {"$in": ["sent", "delivered"]}}) > 0
    return origin_from_records(lead, customer, from_campaign=from_campaign)
