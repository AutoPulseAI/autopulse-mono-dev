"""23 Oct 2026: the AI watches itself - the developers are emailed what needs a look (scheduler/monitor.py)."""

from datetime import timedelta

from bson import ObjectId

from tests.unit.conftest import set_clock
from tests.unit.test_human_contact import TUESDAY_NOON
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, AI_TURN_LOG_COLLECTION
from upsell_agent.scheduler import monitor


async def _turn(mongo, minutes, outcome, text="hi", reply="", violations=()):
    at = TUESDAY_NOON - timedelta(minutes=minutes)
    await mongo[AI_TURN_LOG_COLLECTION].insert_one({
        "_id": ObjectId.from_datetime(at), "created_at": at, "dealer_id": "d1", "lead_id": f"L-{outcome}",
        "trigger": "inbound_message", "outcome": outcome, "input": {"text": text}, "summary": {"reply": reply},
        "nodes": [{"node": "guard", "status": "done", "output": {"violations": list(violations)}}]})


async def test_the_report_lists_problems_and_waiting_customers_then_goes_quiet(mongo):
    set_clock(TUESDAY_NOON)
    await _turn(mongo, 5, "fallback", "Is it the M package?", "Thanks, Arthur. That's something we can go over...",
                ["a trim not on the named vehicle(s): sport"])
    await _turn(mongo, 4, "offer_visit", "Can I come Saturday?", "I have Saturday at 10:00 AM...")  # fine: not listed
    await _turn(mongo, 3, "opt_out_confirmation", "please stop texting me", "Ok, we will not text you again...")
    await mongo[AI_MESSAGES_COLLECTION].insert_one({
        "dealer_id": "d1", "lead_id": "L-wait", "direction": "inbound", "channel": "sms", "text": "11am",
        "answered_turn_id": None, "created_at": TUESDAY_NOON - timedelta(minutes=12)})

    first = await monitor.run()
    assert first["status"] == "sent" and first["problems"] == 1 and first["unanswered"] == 1 and first["notes"] == 1
    [mail] = await mongo["dev_ops_alerts"].find({"audience": "monitor"}).to_list(None)
    assert "SAFE TEMPLATE SENT" in mail["text"] and "a trim not on the named vehicle" in mail["text"]
    assert "NO REPLY" in mail["text"] and "'11am'" in mail["text"] and "opt-out" in mail["text"]
    assert "Can I come Saturday" not in mail["text"]

    # The next check reads only what's new: the same turns aren't reported again.
    await mongo[AI_MESSAGES_COLLECTION].update_one({"lead_id": "L-wait"}, {"$set": {"answered_turn_id": "t1"}})
    set_clock(TUESDAY_NOON + timedelta(minutes=15))
    second = await monitor.run()
    assert second["status"] == "quiet"
    assert len(await mongo["dev_ops_alerts"].find({"audience": "monitor"}).to_list(None)) == 1
