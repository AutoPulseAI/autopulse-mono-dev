"""Stale inventory alert (Betsy, 26 Oct 2026: "How can we safeguard ourselves from stale inventory? We need a
process or alert in place"). The live case: the feed stopped on 12 Sep 2026 and nobody knew for six weeks."""

from datetime import UTC, datetime, timedelta

from bson import ObjectId

from tests.unit.conftest import set_clock
from upsell_agent.scheduler import inventory_watch

DEALER = ObjectId()
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)


class Mail:
    def __init__(self):
        self.sent = []

    async def send_ops_alert(self, subject, text, **_):
        self.sent.append(subject)
        return True


async def _stock(mongo, n, updated, removed=0):
    await mongo["vehicles"].insert_many(
        [{"dealerId": str(DEALER), "vin": f"V{i}", "updatedAt": updated, "removedAt": None} for i in range(n)]
        + [{"dealerId": str(DEALER), "vin": f"R{i}", "updatedAt": updated, "removedAt": updated} for i in range(removed)])


async def test_a_feed_that_stopped_alerts_once_a_day_and_says_when_it_is_back(mongo):
    set_clock(NOW)
    await mongo["users"].insert_one({"_id": DEALER, "type": "dealer", "ai_mode": "live", "name": "Victory Cars Central"})
    await _stock(mongo, 148, NOW - timedelta(days=43))  # last import 12 Sep
    mail = Mail()
    result = await inventory_watch.run(platform=mail)
    assert mail.sent == ["AutoPulse inventory problem - Victory Cars Central"]
    assert "not updated since" in result["dealers"]["Victory Cars Central"][0]
    await inventory_watch.run(platform=mail)
    assert len(mail.sent) == 1  # once a day, not every hour
    await mongo["vehicles"].update_many({}, {"$set": {"updatedAt": NOW}})
    await inventory_watch.run(platform=mail)
    assert mail.sent[-1] == "AutoPulse inventory OK again - Victory Cars Central"


async def test_a_feed_that_suddenly_shrinks_alerts(mongo):
    set_clock(NOW)
    await mongo["users"].insert_one({"_id": DEALER, "type": "dealer", "ai_mode": "live", "name": "Victory"})
    await _stock(mongo, 148, NOW)
    mail = Mail()
    await inventory_watch.run(platform=mail)
    assert mail.sent == []  # healthy: the count is remembered
    await mongo["vehicles"].update_many({"vin": {"$in": [f"V{i}" for i in range(100)]}}, {"$set": {"removedAt": NOW}})
    await inventory_watch.run(platform=mail)
    assert mail.sent == ["AutoPulse inventory problem - Victory"]


async def test_a_dealer_with_the_ai_off_is_not_watched(mongo):
    set_clock(NOW)
    await mongo["users"].insert_one({"_id": DEALER, "type": "dealer", "ai_mode": "off", "name": "Off dealer"})
    await _stock(mongo, 10, NOW - timedelta(days=60))
    mail = Mail()
    await inventory_watch.run(platform=mail)
    assert mail.sent == []
