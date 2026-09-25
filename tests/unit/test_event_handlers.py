"""What the worker does per event (MASTER_PLAN_1 Stage 2): lead state,
pause/resume, cancelling follow-ups, and staying silent on paused leads."""

from datetime import UTC, datetime

from upsell_agent.agent.turn import TurnDeps
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import (
    InboundMessageEvent,
    LeadCreatedEvent,
    LeadPausedEvent,
    LeadResumedEvent,
)
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)

DEALER = simulate.DEV_DEALERS[0]["_id"]


async def _lead():
    return await simulate.create_lead(DEALER, lead_type="service", channel="sms", name="H", comments="Oil change")


def _inbound(created, text="hello", event_id="m1"):
    return InboundMessageEvent(event_id=event_id, dealer_id=DEALER, customer_id=created["customer_id"],
                               lead_id=created["lead_id"], channel="sms", message_id=event_id, text=text,
                               received_at=datetime.now(UTC))


async def test_lead_created_creates_state_and_runs_a_turn(mongo):
    created = await _lead()
    result = await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"), TurnDeps())
    assert result["status"] == "done"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "active" and state["lead_type"] == "service" and state["dealer_id"] == DEALER
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert turn["trigger"] == "lead_created"
    assert turn["input"]["text"] == "Oil change"


async def test_pause_cancels_followups_and_silences_replies(mongo):
    created = await _lead()
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_one(
        {"dealer_id": DEALER, "lead_id": created["lead_id"], "status": "pending", "due_at": datetime.now(UTC)})

    result = await handlers.handle_lead_paused(
        LeadPausedEvent(event_id="p1", dealer_id=DEALER, lead_id=created["lead_id"], reason="Staff replied"))
    assert result == {"status": "paused", "followups_cancelled": 1}

    reply = await handlers.handle_inbound_message(_inbound(created, "anyone there?"), TurnDeps())
    assert reply["status"] == "saved_only"
    assert await mongo[AI_MESSAGES_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 0


async def test_resume_lets_the_ai_reply_again(mongo):
    created = await _lead()
    await handlers.handle_lead_paused(LeadPausedEvent(event_id="p1", dealer_id=DEALER, lead_id=created["lead_id"]))
    await handlers.handle_lead_resumed(LeadResumedEvent(event_id="r1", dealer_id=DEALER, lead_id=created["lead_id"]))

    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "active" and state["status_reason"] is None
    reply = await handlers.handle_inbound_message(_inbound(created, "2020 Subaru, 54k miles"), TurnDeps())
    assert reply["status"] == "done"


async def test_inbound_reply_cancels_pending_followups_first(mongo):
    created = await _lead()
    await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].insert_one(
        {"dealer_id": DEALER, "lead_id": created["lead_id"], "status": "pending", "due_at": datetime.now(UTC)})
    result = await handlers.handle_inbound_message(_inbound(created), TurnDeps())
    assert result["followups_cancelled"] == 1
    doc = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert doc["status"] == "cancelled"


async def test_inbound_without_lead_id_finds_the_customers_latest_lead(mongo):
    created = await _lead()
    event = _inbound(created).model_copy(update={"lead_id": None})
    result = await handlers.handle_inbound_message(event, TurnDeps())
    assert result["status"] == "done"
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1


# --- Stage 4: first reply, STOP / START --------------------------------------------

async def test_first_reply_is_answered_and_sent(mongo):
    created = await _lead()
    result = await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms"),
        TurnDeps(), received_at=datetime.now(UTC).isoformat())
    # Stage 8: the first reply goes through the AI pipeline (offline model in tests).
    assert result["outcome"] == "ask" and result["send_status"] == "sent"
    outbox = await mongo["dev_outbox"].find_one({"lead_id": created["lead_id"]})
    assert "vehicle" in outbox["text"]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["last_send_status"] == "sent" and state["first_reply_ms"] >= 0


async def test_stop_opts_out_and_is_never_answered(mongo):
    created = await _lead()
    result = await handlers.handle_inbound_message(_inbound(created, "STOP"), TurnDeps())
    assert result["status"] == "opted_out"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "opted_out"
    consent = await mongo["ai_consent"].find_one({"customer_id": created["customer_id"]})
    assert consent["sms"]["allowed"] is False
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 0

    later = await handlers.handle_inbound_message(_inbound(created, "hello?", event_id="m2"), TurnDeps())
    assert later["status"] == "saved_only"


async def test_start_after_stop_opts_back_in(mongo):
    created = await _lead()
    await handlers.handle_inbound_message(_inbound(created, "stop"), TurnDeps())
    result = await handlers.handle_inbound_message(_inbound(created, "START", event_id="m2"), TurnDeps())
    assert result["status"] == "opted_in"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "active"
    consent = await mongo["ai_consent"].find_one({"customer_id": created["customer_id"]})
    assert consent["sms"]["allowed"] is True


async def test_yes_is_a_normal_answer_unless_opted_out(mongo):
    created = await _lead()
    result = await handlers.handle_inbound_message(_inbound(created, "Yes"), TurnDeps())
    assert result["status"] == "done"


async def test_stop_inside_a_sentence_is_not_an_opt_out(mongo):
    created = await _lead()
    result = await handlers.handle_inbound_message(_inbound(created, "Can I stop by Saturday?"), TurnDeps())
    assert result["status"] == "done"


async def test_shadow_event_drafts_but_does_not_send(mongo):
    created = await _lead()
    result = await handlers.handle_lead_created(
        LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                         customer_id=created["customer_id"], channel="sms", shadow=True), TurnDeps())
    assert result["send_status"] == "shadow"
    assert await mongo["dev_outbox"].count_documents({}) == 0


async def test_quick_texts_are_answered_together_in_one_turn(mongo):
    """Messages recorded while a turn is pending are answered by that one turn;
    the later jobs find nothing left to answer."""
    created = await _lead()
    first, second, third = (_inbound(created, text, event_id=eid) for text, eid in
                            [("Hi", "q1"), ("It's a 2020 Subaru Outback", "q2"), ("54,000 miles", "q3")])
    for event in (first, second, third):
        await handlers.record_inbound(event)
    result = await handlers.handle_inbound_message(first, TurnDeps())
    assert result["status"] == "done" and result["batched"] == 3
    turn = await mongo[AI_TURN_LOG_COLLECTION].find_one({"turn_id": result["turn_id"]})
    assert turn["input"]["text"] == "Hi\nIt's a 2020 Subaru Outback\n54,000 miles"
    for event in (second, third):
        assert (await handlers.handle_inbound_message(event, TurnDeps()))["status"] == "already_answered"
    assert await mongo[AI_TURN_LOG_COLLECTION].count_documents({"lead_id": created["lead_id"]}) == 1


async def test_recording_the_same_message_twice_is_harmless(mongo):
    created = await _lead()
    event = _inbound(created, "hello")
    await handlers.record_inbound(event)
    await handlers.record_inbound(event)
    assert await mongo[AI_MESSAGES_COLLECTION].count_documents({"platform_message_id": "m1"}) == 1


# --- Re-runs never message twice (Stage 12 hardening) ----------------------------------
# A job can run again: SAQ retries after a late error, or its sweep re-delivers
# a job it lost track of. The turn id comes from what triggered the turn, so a
# re-run reuses the send's idempotency key.

def _created_event(created):
    return LeadCreatedEvent(event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
                            customer_id=created["customer_id"], channel="sms")


async def _outbound(mongo, created):
    return await mongo[AI_MESSAGES_COLLECTION].count_documents(
        {"lead_id": created["lead_id"], "direction": "outbound"})


async def test_a_first_reply_job_that_runs_twice_sends_once(mongo):
    created = await _lead()
    first = await handlers.handle_lead_created(_created_event(created), TurnDeps())
    again = await handlers.handle_lead_created(_created_event(created), TurnDeps())
    assert first["turn_id"] == f"lead-created-{created['lead_id']}"
    assert again == {"status": "already_answered", "turn_id": first["turn_id"], "send_status": "sent"}
    assert await _outbound(mongo, created) == 1


async def test_a_reply_job_rerun_after_a_crash_before_marking_answered_sends_once(mongo):
    created = await _lead()
    await handlers.handle_lead_created(_created_event(created), TurnDeps())
    first = await handlers.handle_inbound_message(_inbound(created, "2020 Subaru, 54k miles"), TurnDeps())
    assert first["status"] == "done"
    # The worker died after sending, before the messages were marked answered.
    await mongo[AI_MESSAGES_COLLECTION].update_many({"lead_id": created["lead_id"], "direction": "inbound"},
                                                    {"$set": {"answered_turn_id": None}})
    again = await handlers.handle_inbound_message(_inbound(created, "2020 Subaru, 54k miles"), TurnDeps())
    assert again["status"] == "already_answered" and again["turn_id"] == first["turn_id"]
    assert await _outbound(mongo, created) == 2  # first reply + one answer, not two

    # A genuinely new message still gets its own answer.
    new = await handlers.handle_inbound_message(_inbound(created, "mornings are best", event_id="m2"), TurnDeps())
    assert new["status"] == "done" and new["turn_id"] != first["turn_id"]
    assert await _outbound(mongo, created) == 3
