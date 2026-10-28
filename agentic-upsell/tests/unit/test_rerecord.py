"""The user, 28 Oct 2026: a sent message the CRM didn't record is tried again until it is."""

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.channels import rerecord
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION


class Crm:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    async def record_message(self, dealer_id, payload):
        self.calls.append(payload["idempotency_key"])
        if self.fail:
            raise TimeoutError("slow")
        return "email-1"


async def test_an_unrecorded_sent_message_is_recorded_later(mongo):
    row = {"_id": ObjectId(), "dealer_id": "D1", "direction": "outbound", "status": "sent", "channel": "sms",
           "text": "Hi", "idempotency_key": "k1", "platform_record_id": None, "platform_record_error": "ReadTimeout",
           "created_at": clock.now().replace(tzinfo=None), "lead_id": "L1"}
    await mongo[AI_MESSAGES_COLLECTION].insert_one(row)
    assert await rerecord.run(platform=Crm(fail=True)) == {"recorded": 0, "still_failing": 1}
    assert await rerecord.run(platform=Crm()) == {"recorded": 1, "still_failing": 0}
    saved = await mongo[AI_MESSAGES_COLLECTION].find_one({"_id": row["_id"]})
    assert saved["platform_record_id"] == "email-1" and "platform_record_error" not in saved
    assert await rerecord.run(platform=Crm()) == {"recorded": 0, "still_failing": 0}
