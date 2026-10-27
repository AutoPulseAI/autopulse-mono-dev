"""The understanding layer in shadow (27 Oct 2026): after a reply is sent, the whole conversation is read and the
reply judged; the result is saved and nothing the customer gets changes."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from upsell_agent.agent import understanding
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, AI_UNDERSTANDING_COLLECTION

DEALER = "d1"
T0 = datetime(2026, 10, 26, 23, 8, tzinfo=UTC)


def _deps(model="openai:gpt-5-mini"):
    return SimpleNamespace(config=SimpleNamespace(model_compose=model))


async def _muhamad(mongo):
    rows = [("inbound", None, "I'm mostly looking for an m240"),
            ("outbound", "t1", "I have a 2025 BMW 2 Series 228 xDrive. Would Tuesday at 10:00 AM work?"),
            ("inbound", None, "No m240"),
            ("outbound", "t2", "I do have a 2025 BMW 2 Series 228 xDrive. Would Tuesday at 10:00 AM work?")]
    for i, (direction, turn, text) in enumerate(rows):
        await mongo[AI_MESSAGES_COLLECTION].insert_one({
            "dealer_id": DEALER, "lead_id": "L1", "direction": direction, "turn_id": turn, "channel": "sms",
            "status": "sent" if direction == "outbound" else "received", "text": text,
            "created_at": T0 + timedelta(minutes=i)})


async def test_the_reply_is_judged_and_saved(mongo, monkeypatch):
    await _muhamad(mongo)
    seen = {}

    async def fake_run(agent, model, payload, **_):
        seen.update(payload)
        review = understanding.ReplyReview(answers_customer=False, repeats_us=True, pushes_refused=True, ok=False,
                                           problem="Offered the 228 again after No m240.")
        return understanding.Understanding(wants="BMW M240", refused=["BMW 228"], stop_request=False,
                                           wants_person=False, readiness="interested",
                                           next_step="Say we have no M240 now and offer to watch for one.",
                                           reply=review), SimpleNamespace(as_metrics=lambda: {})

    monkeypatch.setattr(understanding, "run_agent", fake_run)
    out = await understanding.understand_turn(DEALER, "L1", "t2", _deps())
    assert out == {"status": "saved", "flagged": True}
    assert [m["from"] for m in seen["messages"]] == ["customer", "ai", "customer", "ai"]
    assert seen["last_reply"].startswith("I do have")
    assert seen["last_reply_photos"] == 0
    doc = await mongo[AI_UNDERSTANDING_COLLECTION].find_one({"lead_id": "L1"})
    assert doc["flagged"] and doc["understanding"]["refused"] == ["BMW 228"]


async def test_never_on_the_offline_model(mongo):
    await _muhamad(mongo)
    assert (await understanding.understand_turn(DEALER, "L1", "t2", _deps("offline")))["status"] == "skipped"


async def test_a_failure_changes_nothing(mongo, monkeypatch):
    await _muhamad(mongo)

    async def boom(*_, **__):
        raise TimeoutError

    monkeypatch.setattr(understanding, "run_agent", boom)
    assert (await understanding.understand_turn(DEALER, "L1", "t2", _deps()))["status"] == "failed"
    assert await mongo[AI_UNDERSTANDING_COLLECTION].count_documents({}) == 0
