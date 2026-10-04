"""Is the customer replying to a campaign? (architecture §5, MASTER_PLAN_1
Stage 9.)

The dealer creates and sends campaigns in the platform; the AI only answers.
A reply is a campaign reply when the most recent thing we sent this customer
in the last 14 days was a campaign message (a `CampaignLead` marked sent)
rather than an AI message. Compose then gets the campaign's text and goal,
so it knows what the customer is replying to.

Platform shapes (aidmvcs-be-dev/app/models): CampaignLead.dealer_id is a
string, Campaign.dealer_id is an ObjectId (ref User), Campaign's text is
message_content.body and its goal is `description`.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.agent.customer_key import find_customer_leads
from upsell_agent.integrations.mongodb import (
    AI_MESSAGES_COLLECTION,
    DealerScopedDatabase,
    get_db,
)

CAMPAIGN_WINDOW = timedelta(days=14)
CAMPAIGN_LEADS_COLLECTION = "campaignleads"
CAMPAIGNS_COLLECTION = "campaigns"


def _aware(value: datetime | None) -> datetime | None:
    return value if value is None or value.tzinfo else value.replace(tzinfo=UTC)


async def find_campaign_context(db: DealerScopedDatabase, *, customer_id: str) -> dict[str, Any] | None:
    now = clock.now()
    leads = await find_customer_leads(db, customer_id)
    lead_ids = [lead["_id"] for lead in leads]
    if not lead_ids:
        return None

    sends = await db.collection(CAMPAIGN_LEADS_COLLECTION).find(
        {"lead_id": {"$in": lead_ids}, "status": {"$in": ["sent", "delivered"]}}).to_list(None)
    sends = [s for s in sends if s.get("sent_at") and now - _aware(s["sent_at"]) <= CAMPAIGN_WINDOW]
    if not sends:
        return None
    latest = max(sends, key=lambda s: _aware(s["sent_at"]))

    ai_sent = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": {"$in": [str(i) for i in lead_ids]}, "direction": "outbound", "status": "sent"}).to_list(None)
    last_ai = max((_aware(m.get("sent_at") or m["created_at"]) for m in ai_sent), default=None)
    if last_ai and last_ai > _aware(latest["sent_at"]):
        return None  # we have spoken since; the customer is replying to us, not the campaign

    if not ObjectId.is_valid(str(latest.get("campaign_id"))) or not ObjectId.is_valid(db.dealer_id):
        return None
    # Campaign.dealer_id is an ObjectId, so the dealer-scoped layer (string
    # dealer_id) can't be used; the dealer is checked explicitly instead.
    campaign = await get_db()[CAMPAIGNS_COLLECTION].find_one(
        {"_id": ObjectId(str(latest["campaign_id"])), "dealer_id": ObjectId(db.dealer_id)})
    if not campaign:
        return None
    content = campaign.get("message_content") or {}
    return {
        "campaign_id": str(campaign["_id"]),
        "name": campaign.get("name"),
        "goal": campaign.get("description") or "",
        "subject": content.get("subject") or "",
        "body": content.get("body") or "",
        "channel": campaign.get("message_type"),
        "sent_at": _aware(latest["sent_at"]).isoformat(),
        "lead_id": str(latest.get("lead_id")),
    }
