"""The user, 28 Oct 2026: AutoPulse is told when due follow-ups aren't going out."""

from datetime import UTC, datetime, timedelta

from tests.unit.conftest import set_clock
from upsell_agent.integrations.mongodb import SCHEDULED_FOLLOWUPS_COLLECTION
from upsell_agent.scheduler import cadence_watch


class Ops:
    def __init__(self):
        self.sent = []

    async def send_ops_alert(self, subject, text, audience="ops"):
        self.sent.append((subject, text))
        return True


async def test_stuck_follow_ups_raise_one_alert_a_day(mongo):
    now = datetime(2026, 10, 28, 18, 0, tzinfo=UTC)
    set_clock(now)
    due = (now - timedelta(hours=2)).replace(tzinfo=None)
    rows = [{"dealer_id": "D1", "kind": "cadence_touch", "status": "pending", "due_at": due} for _ in range(12)]
    rows += [{"dealer_id": "D1", "kind": "cadence_touch", "status": "sent", "due_at": due} for _ in range(8)]
    rows += [{"dealer_id": "D2", "kind": "appointment_confirm", "status": "sent", "due_at": due} for _ in range(30)]
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_many(rows)
    ops = Ops()
    assert (await cadence_watch.run(platform=ops))["alerted"] == ["D1"]
    assert "12 of the 20" in ops.sent[0][1]
    assert (await cadence_watch.run(platform=ops))["alerted"] == []  # once a day


async def test_a_few_late_ones_are_no_alert(mongo):
    now = datetime(2026, 10, 28, 18, 0, tzinfo=UTC)
    set_clock(now)
    due = (now - timedelta(hours=2)).replace(tzinfo=None)
    rows = [{"dealer_id": "D1", "kind": "cadence_touch", "status": "pending", "due_at": due} for _ in range(3)]
    rows += [{"dealer_id": "D1", "kind": "cadence_touch", "status": "sent", "due_at": due} for _ in range(40)]
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_many(rows)
    assert (await cadence_watch.run(platform=Ops()))["alerted"] == []
