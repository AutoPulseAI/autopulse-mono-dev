"""MASTER_PLAN_3 B1, the after-hours first reply: a new inbound lead that
arrives while the dealership is closed is asked "now, or when we open?";
"later" gets a thank-you and a morning message at opening (a whole AI turn,
plus a notice for the team); "now", a visit request or ignoring the choice
carries the conversation on. The clock is moved; nothing waits."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from upsell_agent import clock
from upsell_agent.agent.after_hours import plan_after_hours
from upsell_agent.agent.conversation import AfterHoursChoice, ConversationState
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.turn import TurnDeps, run_turn
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message, handle_lead_paused
from upsell_agent.events.models import InboundMessageEvent, LeadPausedEvent
from upsell_agent.integrations.dealer_profile import profile_from_record
from upsell_agent.integrations.mongodb import dealer_scoped_db  # noqa: E402
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink, NodeSpan, TurnTracer
from upsell_agent.scheduler import followups

DEALER = simulate.DEV_DEALERS[0]["_id"]
# The send check needs the customer's zone; dev customers have none (conftest.py).
pytestmark = pytest.mark.usefixtures("ny_customer")
NY = "America/New_York"
# Tuesday 22 Sept 2026, 23:00 New York: the dev dealer (Mon-Fri 9:00-19:00) is closed.
TUESDAY_NIGHT = datetime(2026, 9, 23, 3, 0, tzinfo=UTC)
# Wednesday 9:01 New York: just open.
WEDNESDAY_OPEN = datetime(2026, 9, 23, 13, 1, tzinfo=UTC)
# Tuesday 12:00 New York: open.
TUESDAY_NOON = datetime(2026, 9, 22, 16, 0, tzinfo=UTC)
NOW_CLOSED = {"open_now": False, "next_open_text": "9:00 AM tomorrow"}
NOW_OPEN = {"open_now": True, "next_open_text": None}


# --- The rules (agent/after_hours.py) ----------------------------------------------------

def _plan(*, trigger="lead_created", origin="inbound", now=NOW_CLOSED, turn=0, record=None, extraction=None,
         text=""):
    conversation = ConversationState(turn=turn, after_hours=AfterHoursChoice(**record) if record else None)
    return plan_after_hours(trigger=trigger, origin=origin, now=now, conversation=conversation,
                            extraction=extraction or {}, at=TUESDAY_NIGHT, text=text)


def test_first_reply_of_an_inbound_lead_while_closed_offers_the_choice():
    plan = _plan()
    assert plan.mode == "offer" and plan.opens_at == "9:00 AM tomorrow"
    assert plan.record["choice"] == "offered" and plan.record["times_offered"] == 1 and plan.record["offered_turn"] == 1
    # A customer's first text counts as a first contact too.
    assert _plan(trigger="inbound_message").mode == "offer"


@pytest.mark.parametrize(("kwargs", "why"), [
    ({"now": NOW_OPEN}, "open"),
    ({"origin": "outbound"}, "outbound"),
    ({"origin": None}, "unknown"),
    ({"turn": 1}, "Not the first reply"),
])
def test_no_choice(kwargs, why):
    plan = _plan(**kwargs)
    assert plan.mode is None and plan.record is None and why in plan.why


def test_a_visit_request_is_never_met_with_the_choice():
    plan = _plan(extraction={"wants_visit": True, "wants_visit_confidence": 0.9})
    assert plan.mode is None and plan.record["choice"] == "now"
    # Not sure enough: still offered.
    assert _plan(extraction={"wants_visit": True, "wants_visit_confidence": 0.5}).mode == "offer"


OFFERED = {"choice": "offered", "times_offered": 1, "offered_turn": 1}
LATER = {"choice": "later", "times_offered": 1, "offered_turn": 1}


@pytest.mark.parametrize(("extraction", "choice", "mode"), [
    ({"contact_preference": "later"}, "later", "later"),
    ({"contact_preference": "now"}, "now", None),
    ({}, "now", None),  # ignored the choice: counts as now
    ({"contact_preference": "later", "wants_visit": True, "wants_visit_confidence": 0.9}, "now", None),
])
def test_answer_to_the_offer(extraction, choice, mode):
    plan = _plan(trigger="inbound_message", turn=1, record=OFFERED, extraction=extraction)
    assert plan.record["choice"] == choice and plan.mode == mode
    # The offer already planned the morning message (no answer = wait): "later" keeps it, anything else cancels it.
    assert plan.schedule_resume == (choice == "later") and plan.cancel_resume == (choice == "now")


def test_the_answer_is_only_read_against_our_offer():
    # "later" in a message that doesn't answer the choice (our last reply didn't offer it).
    plan = _plan(trigger="inbound_message", turn=2, record=OFFERED, extraction={"contact_preference": "later"})
    assert plan.record["choice"] == "now"


def test_writing_again_after_later_re_offers_the_choice_every_time():
    plan = _plan(trigger="inbound_message", turn=2, record=LATER)  # our last reply was the thank-you
    assert plan.mode == "offer" and plan.record["choice"] == "later"
    assert plan.record["times_offered"] == 2 and plan.record["offered_turn"] == 3
    again = _plan(trigger="inbound_message", turn=4, record={**LATER, "times_offered": 2, "offered_turn": 3})
    assert again.mode == "offer" and again.record["times_offered"] == 3


@pytest.mark.parametrize(("extraction", "choice", "mode", "cancel"), [
    ({"contact_preference": "later"}, "later", "later", False),   # still later: keep the morning message
    ({"contact_preference": "now"}, "now", None, True),
    ({}, "now", None, True),                                      # ignored the re-offer: now
])
def test_answer_to_the_re_offer(extraction, choice, mode, cancel):
    plan = _plan(trigger="inbound_message", turn=3, record={**LATER, "times_offered": 2, "offered_turn": 3},
                 extraction=extraction)
    assert plan.record["choice"] == choice and plan.mode == mode and plan.cancel_resume == cancel
    assert not plan.schedule_resume  # the morning message is already scheduled


def test_a_visit_request_after_later_carries_on_and_cancels_the_morning_message():
    plan = _plan(trigger="inbound_message", turn=2, record=LATER,
                 extraction={"wants_visit": True, "wants_visit_confidence": 0.9})
    assert plan.mode is None and plan.record["choice"] == "now" and plan.cancel_resume


def test_once_open_the_choice_no_longer_applies():
    plan = _plan(trigger="inbound_message", turn=2, record=LATER, now=NOW_OPEN)
    assert plan.record["choice"] == "now" and plan.cancel_resume and plan.mode is None
    assert _plan(trigger="inbound_message", turn=1, record=OFFERED, now=NOW_OPEN,
                 extraction={"contact_preference": "later"}).record["choice"] == "now"


def test_now_is_never_asked_again():
    plan = _plan(trigger="inbound_message", turn=5, record={"choice": "now", "times_offered": 1, "offered_turn": 1})
    assert plan.mode is None and plan.record is None


def test_resume_turn_is_the_morning_message():
    plan = _plan(trigger="resume_at_opening", turn=2, record=LATER, now=NOW_OPEN)
    assert plan.mode == "resume" and plan.record["choice"] == "now"


# --- Dealer hours (integrations/dealer_profile.py) ------------------------------------------

def _dealer_profile(**info):
    return profile_from_record(DEALER, {"dealer_account_information": {"time_zone": NY, **info}})


def test_next_opening_and_how_it_reads():
    profile = _dealer_profile(weekly_availability=simulate.DEV_WEEKLY_AVAILABILITY)
    assert not profile.is_open(TUESDAY_NIGHT) and profile.is_open(TUESDAY_NOON)
    opens = profile.next_opening(TUESDAY_NIGHT)
    assert opens == datetime(2026, 9, 23, 13, 0, tzinfo=UTC)
    assert profile.opening_text(opens, TUESDAY_NIGHT) == "9:00 AM tomorrow"
    # Saturday 18:00: closed Sunday, opens Monday.
    saturday_evening = datetime(2026, 9, 26, 22, 0, tzinfo=UTC)
    monday = profile.next_opening(saturday_evening)
    assert profile.opening_text(monday, saturday_evening) == "9:00 AM Monday"
    # Early the same morning: "today".
    early = datetime(2026, 9, 23, 10, 0, tzinfo=UTC)
    assert profile.opening_text(profile.next_opening(early), early) == "9:00 AM today"


# --- End to end ---------------------------------------------------------------------------

@pytest.fixture
async def dealer_with_hours(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({
        "_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True},
        "dealer_account_information": {"time_zone": NY, "weekly_availability": simulate.DEV_WEEKLY_AVAILABILITY}})


def _deps():
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(),
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(comments="Hi, I want a new Toyota RAV4"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                         comments=comments)
    await run_turn(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                   trigger="lead_created", channel="sms", inbound_text=comments, shadow=False, deps=_deps())
    return created


async def _say(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms",
                                text=text, received_at=clock.now())
    return await handle_inbound_message(event, _deps())


async def _last_sms(mongo, created):
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).sort("created_at", -1).to_list(1)
    return rows[0]["text"]


async def _state(mongo, created):
    return await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})


async def _resumes(mongo, created):
    """The morning messages, without the ones a newer one replaced (the offer plans one; "later" re-plans it)."""
    rows = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": followups.KIND_RESUME}).to_list(None)
    return [r for r in rows if r["status"] != "superseded"]


async def _turns(mongo, created):
    return await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]}).sort("created_at", 1).to_list(None)


async def test_lead_at_night_gets_the_choice_and_no_other_question(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    reply = await _last_sms(mongo, created)
    assert "We're closed right now and open again at 9:00 AM tomorrow" in reply
    # MASTER_PLAN_3 C4, client 1 Oct 2026 (decision 34 reversed): Touch 1 always asks what they drive now,
    # so the first reply carries two questions - that one, then the choice, which stays the last thing said.
    assert reply.endswith("continue during business hours?") and reply.count("?") == 2
    assert reply.index("what are you driving now?") < reply.index("We're closed right now")
    [turn] = await _turns(mongo, created)
    assert turn["summary"]["after_hours"] == "offer" and turn["summary"]["asked"] == ["trade_in.has_trade"]
    decide = next(n for n in turn["nodes"] if n["node"] == "decide")
    assert decide["output"]["asks"] == [] and decide["output"]["after_hours"]["mode"] == "offer"
    load = next(n for n in turn["nodes"] if n["node"] == "load_context")
    assert load["output"]["context"]["now"]["open_now"] is False
    state = await _state(mongo, created)
    assert state["conversation"]["after_hours"]["choice"] == "offered"


async def test_lead_during_opening_hours_gets_no_choice(mongo, dealer_with_hours):
    set_clock(TUESDAY_NOON)
    created = await _lead()
    reply = await _last_sms(mongo, created)
    assert "closed" not in reply and "?" in reply
    assert (await _state(mongo, created))["conversation"].get("after_hours") is None


async def test_now_carries_the_conversation_on_at_night(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    result = await _say(created, "now is fine")
    assert result["outcome"] == "ask"  # the normal conversation, at 23:00 (decision 56)
    reply = await _last_sms(mongo, created)
    assert "closed" not in reply and 1 <= reply.count("?") <= 2
    assert (await _state(mongo, created))["conversation"]["after_hours"]["choice"] == "now"
    # The offer planned the morning message; "now" cancelled it.
    assert [r["status"] for r in await _resumes(mongo, created)] == ["cancelled"]
    # Never offered again the same night.
    await _say(created, "what colours do you have?")
    assert "continue during business hours?" not in await _last_sms(mongo, created)


async def test_ignoring_the_choice_counts_as_now(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "Is it a hybrid?")
    assert (await _state(mongo, created))["conversation"]["after_hours"]["choice"] == "now"
    assert "continue during business hours?" not in await _last_sms(mongo, created)


async def test_later_then_the_morning_message_at_opening(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    result = await _say(created, "tomorrow is fine")
    reply = await _last_sms(mongo, created)
    assert "I'll pick this up when we open at 9:00 AM tomorrow" in reply and "?" not in reply
    assert result["outcome"] == "acknowledge"
    [resume] = await _resumes(mongo, created)
    assert resume["status"] == "pending" and resume["to_channel"] == "sms"
    assert resume["due_at"].replace(tzinfo=UTC) == datetime(2026, 9, 23, 13, 0, tzinfo=UTC)  # Wed 9:00 New York

    set_clock(WEDNESDAY_OPEN)
    fired = await followups.fire_due(_deps())
    assert fired["results"] == {"sent": 1}
    [resume] = await _resumes(mongo, created)
    assert resume["status"] == "sent"
    morning = await _last_sms(mongo, created)
    assert morning.startswith("Good morning, Maria! We're open now.") and 1 <= morning.count("?") <= 2
    turns = await _turns(mongo, created)
    turn = next(t for t in turns if t["trigger"] == "resume_at_opening")
    ran = {n["node"] for n in turn["nodes"] if n["status"] == "done"}
    assert "extract" not in ran and {"load_context", "decide", "compose", "guard", "send"} <= ran
    assert any(t["trigger"] == "resume_check" and t["outcome"] == "resume_started" for t in turns)
    state = await _state(mongo, created)
    assert state["conversation"]["after_hours"]["choice"] == "now"
    assert state["staff_notice"]["kind"] == "after_hours_resume"
    assert "pick this up at opening" in state["staff_notice"]["text"]


async def test_writing_again_after_later_is_answered_and_re_offered(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "tomorrow is fine")
    await _say(created, "oh also, do you have it in red?")
    reply = await _last_sms(mongo, created)
    assert ("manager" in reply or "matching" in reply) and reply.endswith("continue during business hours?")
    state = await _state(mongo, created)
    assert state["conversation"]["after_hours"]["choice"] == "later"
    assert state["conversation"]["after_hours"]["times_offered"] == 2
    assert [r["status"] for r in await _resumes(mongo, created)] == ["pending"]

    # Later again: still waiting for the morning message.
    await _say(created, "later please")
    assert "?" not in await _last_sms(mongo, created)
    assert [r["status"] for r in await _resumes(mongo, created)] == ["pending"]

    # Asked a third time, then ignored: counts as now, and the morning message is cancelled.
    await _say(created, "is it AWD?")
    assert (await _last_sms(mongo, created)).endswith("continue during business hours?")
    await _say(created, "it's for my daughter")
    assert (await _state(mongo, created))["conversation"]["after_hours"]["choice"] == "now"
    assert [r["status"] for r in await _resumes(mongo, created)] == ["cancelled"]


async def test_a_visit_request_after_later_carries_on(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "tomorrow is fine")
    await _say(created, "Actually can I come see it tomorrow at 10?")
    assert "continue during business hours?" not in await _last_sms(mongo, created)
    assert (await _state(mongo, created))["conversation"]["after_hours"]["choice"] == "now"
    assert [r["status"] for r in await _resumes(mongo, created)] == ["cancelled"]


async def test_customer_writing_after_opening_cancels_the_morning_message(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "tomorrow is fine")
    set_clock(WEDNESDAY_OPEN - timedelta(seconds=30))  # 9:00:30, before the cron fires
    await _say(created, "Hi, I'm here now")
    assert [r["status"] for r in await _resumes(mongo, created)] == ["cancelled"]
    assert (await _state(mongo, created))["conversation"]["after_hours"]["choice"] == "now"


async def test_staff_taking_over_cancels_the_morning_message(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "tomorrow is fine")
    await handle_lead_paused(LeadPausedEvent(event_id="p-1", dealer_id=DEALER, lead_id=created["lead_id"]))
    assert [r["status"] for r in await _resumes(mongo, created)] == ["cancelled"]


async def test_a_customer_message_does_not_cancel_the_morning_message_by_itself(mongo, dealer_with_hours):
    """The reply cancels channel switches, not the morning message: the plan decides (re-offer here)."""
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "tomorrow is fine")
    result = await _say(created, "thanks")
    assert result["followups_cancelled"] == 1  # the thank-you's 24h channel switch only
    assert [r["status"] for r in await _resumes(mongo, created)] == ["pending"]


async def test_no_hours_on_record_offers_without_a_time(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one(
        {"_id": ObjectId(DEALER), "type": "dealer", "ai_mode": "live", "setting": {"autoReplyEnabled": True}})
    set_clock(TUESDAY_NIGHT)  # the default hours (Mon-Sat 9:00-18:00) apply, but are never told
    created = await _lead()
    reply = await _last_sms(mongo, created)
    assert "We're closed right now. Would you like to chat now" in reply and "9:00" not in reply


# --- Extract's answer to the choice (agent/nodes/extract.py) --------------------------------

def test_the_answer_to_the_choice_is_moved_out_of_the_slot_values():
    from upsell_agent.agent.nodes.extract import extract_payload, lift_contact_preference

    answer = {"path": "contact_preference", "value": "later", "quote": "tomorrow is fine", "confidence": 0.9}
    extraction = {"values": [answer, {"path": "interest.model", "value": "RAV4"}]}
    lift_contact_preference(extraction, awaiting=True)
    assert extraction["contact_preference"] == "later"
    assert [v["path"] for v in extraction["values"]] == ["interest.model"]  # never saved as a slot
    # Not asked: dropped, never a slot and never an answer.
    extraction = {"values": [dict(answer)]}
    lift_contact_preference(extraction, awaiting=False)
    assert extraction == {"values": [], "contact_preference": None}
    # The model is offered the pseudo-slot only while the choice is pending.
    def paths(awaiting):
        state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", context_pack={
            "conversation": {"awaiting_contact_choice": awaiting}})
        return [s["path"] for s in extract_payload(state)["allowed_slots"]]
    assert "contact_preference" in paths(True) and "contact_preference" not in paths(False)


# --- Found live 1 Oct: the real model dropped the choice, and stray extract values -----------

async def test_guard_sends_back_an_offer_with_no_choice_question():
    """Seen live: acknowledge + after_hours offer produced a closing line with
    no "which would you like?" at all."""
    from upsell_agent.agent.nodes.guard import guard, missing_after_hours_choice

    text = "Hello, Test! I'll pick this up when we open at 9:00 AM today. Let me know if anything else!"
    decision = {"action": "acknowledge", "after_hours": {"mode": "offer", "opens_at": "9:00 AM today"}}
    assert missing_after_hours_choice(decision, {"sms_text": text, "email_body": text}) == [
        "the SMS doesn't offer the after-hours choice", "the email doesn't offer the after-hours choice"]
    state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", customer_text="ok",
                       decision=decision, draft={"sms_text": text, "email_subject": "Hi", "email_body": text})
    tracer = TurnTracer(sink=MemoryTraceSink(), dealer_id="d", lead_id=None, customer_id="c", trigger="t",
                        channel="sms", store_prompts=False)
    result = (await guard(state, NodeSpan(), SimpleNamespace(tracer=tracer)))["guard_result"]
    assert not result["passed"] and not result["checks"]["after_hours_choice_offered"]
    assert result["next"] == "compose"

    ok_text = text.rstrip("!") + " Would you like to chat now, or would you prefer to continue during business hours?"
    assert missing_after_hours_choice(decision, {"sms_text": ok_text, "email_body": ok_text}) == []
    assert missing_after_hours_choice({"action": "acknowledge"}, {"sms_text": text}) == []  # no after_hours: n/a


def test_a_stray_wants_visit_value_is_moved_out_and_never_a_slot():
    from upsell_agent.agent.nodes.extract import lift_wants_visit

    stray = {"path": "wants_visit", "value": True, "quote": "can I visit?", "confidence": 0.9}
    extraction = {"values": [stray, {"path": "interest.model", "value": "Camry"}],
                 "wants_visit": False, "wants_visit_confidence": 0.0}
    lift_wants_visit(extraction)
    assert [v["path"] for v in extraction["values"]] == ["interest.model"]  # never reaches Validate
    assert extraction["wants_visit"] is True and extraction["wants_visit_confidence"] == 0.9
    # The model's own field wins when it already said so, at whichever confidence is higher.
    extraction = {"values": [dict(stray, confidence=0.5)], "wants_visit": True, "wants_visit_confidence": 0.95}
    lift_wants_visit(extraction)
    assert extraction["wants_visit_confidence"] == 0.95


# --- Found live 1 Oct: an "ok" re-offered the choice with a repeated greeting -----------------

def test_a_plain_acknowledgement_is_a_no_op():
    from upsell_agent.agent.after_hours import is_plain_acknowledgement

    for text in ["ok", "Ok!", "okay.", "thanks", "Thanks!", "sounds good", "got it", "no problem", "kk", "yep"]:
        assert is_plain_acknowledgement(text), text
    for text in ["ok but is it AWD?", "ok, i'll wait", "okay next week", "", "no"]:
        assert not is_plain_acknowledgement(text), text


@pytest.mark.parametrize("choice", ["offered", "later"])
def test_plain_acknowledgement_does_not_change_the_after_hours_state(choice):
    record = {"choice": choice, "times_offered": 1, "offered_turn": 1}
    plan = _plan(trigger="inbound_message", turn=1 if choice == "offered" else 2, record=record, text="ok")
    assert plan.mode is None and plan.record is None and not plan.cancel_resume and not plan.schedule_resume
    assert "no change" in plan.why


def test_a_plain_acknowledgement_after_later_does_not_re_offer():
    plan = _plan(trigger="inbound_message", turn=2, record=LATER, text="thanks")
    assert plan.mode is None and plan.record is None


def test_a_real_message_after_later_still_re_offers():
    # Unchanged: only a *plain* acknowledgement is a no-op.
    plan = _plan(trigger="inbound_message", turn=2, record=LATER, text="oh also, is it AWD?")
    assert plan.mode == "offer"


async def test_guard_sends_back_a_repeated_sms_greeting():
    from upsell_agent.agent.nodes.guard import guard, repeats_greeting

    assert repeats_greeting(0, {"sms_text": "Hello, Test! How can I help?"}) == []  # first reply: fine
    assert repeats_greeting(1, {"sms_text": "Hello, Test! How can I help?"}) == [
        "the SMS greets the customer again (this isn't the first reply)"]
    assert repeats_greeting(1, {"email_body": "Hi Test,\n\nHow can I help?"}) == []  # email always greets

    state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", customer_text="ok",
                       context_pack={"conversation": {"turn": 2}},
                       draft={"sms_text": "Hello, Test! Noted.", "email_subject": "Hi", "email_body": "Hi Test, noted."})
    tracer = TurnTracer(sink=MemoryTraceSink(), dealer_id="d", lead_id=None, customer_id="c", trigger="t",
                        channel="sms", store_prompts=False)
    result = (await guard(state, NodeSpan(), SimpleNamespace(tracer=tracer)))["guard_result"]
    assert not result["passed"] and not result["checks"]["no_repeated_greeting"]


async def test_the_resume_message_is_exempt_from_the_greeting_check():
    from upsell_agent.agent.nodes.guard import guard

    state = AgentState(dealer_id="d", customer_id="c", trigger="resume_at_opening", customer_text="",
                       context_pack={"conversation": {"turn": 3}},
                       decision={"after_hours": {"mode": "resume"}},
                       draft={"sms_text": "Good evening, Test! We're open now.", "email_subject": "Hi",
                              "email_body": "Good evening, Test! We're open now."})
    tracer = TurnTracer(sink=MemoryTraceSink(), dealer_id="d", lead_id=None, customer_id="c", trigger="t",
                        channel="sms", store_prompts=False)
    result = (await guard(state, NodeSpan(), SimpleNamespace(tracer=tracer)))["guard_result"]
    assert result["checks"]["no_repeated_greeting"]


# --- Client, 8 Oct 2026: every closed period on its own; no answer = wait for opening -------------------------

async def test_no_answer_to_the_offer_means_the_team_picks_it_up_at_opening(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    assert (await _last_sms(mongo, created)).endswith("continue during business hours?")
    [resume] = await _resumes(mongo, created)  # planned with the offer: the customer never answers
    assert resume["status"] == "pending"
    assert resume["due_at"].replace(tzinfo=UTC) == datetime(2026, 9, 23, 13, 0, tzinfo=UTC)  # Wed 9:00 New York
    set_clock(WEDNESDAY_OPEN)
    assert (await followups.fire_due(_deps()))["results"] == {"sent": 1}
    assert (await _last_sms(mongo, created)).startswith("Good morning, Maria!")


async def test_a_conversation_already_going_is_asked_again_on_a_later_night(mongo, dealer_with_hours):
    set_clock(TUESDAY_NIGHT)
    created = await _lead()
    await _say(created, "now is fine")  # Tuesday night's choice
    set_clock(TUESDAY_NIGHT + timedelta(days=1))  # Wednesday night: a new closed period
    await _say(created, "hey, is the RAV4 still there?")
    assert (await _last_sms(mongo, created)).endswith("continue during business hours?")
    state = await _state(mongo, created)
    assert state["conversation"]["after_hours"]["choice"] == "offered"
    assert [r["status"] for r in await _resumes(mongo, created)][-1] == "pending"


async def test_closed_but_inside_texting_hours_helps_now_without_the_team(mongo, dealer_with_hours):
    # Client, 12 Oct 2026 (Betsy): 8:00 PM in New York - the dealership closed at 7, but it's still legal to
    # text. "The dealership is closed right now and I can help you right now is fine, but stop saying the team
    # can do this and that."
    set_clock(datetime(2026, 9, 23, 0, 0, tzinfo=UTC))
    created = await _lead()
    reply = await _last_sms(mongo, created)
    assert "closed right now" in reply and "help you right now" in reply
    assert "business hours?" not in reply and "team" not in reply.lower()
    [turn] = await _turns(mongo, created)
    assert turn["summary"]["after_hours"] == "closed"


async def _staff_replied(created):
    await handle_lead_paused(LeadPausedEvent(event_id=f"p-{ObjectId()}", dealer_id=DEALER, lead_id=created["lead_id"],
                                             reason="Staff replied by hand (Mercy)"), _deps())


async def _quiet(mongo, created):
    return await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find(
        {"lead_id": created["lead_id"], "kind": followups.KIND_STAFF_QUIET}).to_list(None)


async def test_the_ai_picks_the_conversation_back_up_when_staff_go_quiet(mongo, dealer_with_hours):
    """Client, 20 Oct 2026 (Betsy approved; Jeffry Turman waited 15 hours after a staff text)."""
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await _staff_replied(created)
    await _say(created, "Can I come in at 4 today?")
    [quiet] = await _quiet(mongo, created)
    assert quiet["status"] == "pending"
    due = quiet["due_at"].replace(tzinfo=UTC) - TUESDAY_NOON
    assert followups.STAFF_QUIET_AFTER <= due < followups.STAFF_QUIET_AFTER + timedelta(seconds=5)
    before = await _last_sms(mongo, created)

    set_clock(TUESDAY_NOON + timedelta(minutes=16))
    await followups.fire_due(_deps())
    state = await _state(mongo, created)
    [fired] = await _quiet(mongo, created)
    assert fired["status"] == "sent", fired.get("reason")
    # The AI took the lead back and answered: here it booked the 4 PM visit the customer asked for.
    assert state["status"] == "active" and state["stage"] == "appointment_set"
    assert await _last_sms(mongo, created) != before
    [quiet] = await _quiet(mongo, created)
    assert quiet["status"] == "sent"


async def test_a_new_staff_reply_keeps_the_ai_off(mongo, dealer_with_hours):
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await _staff_replied(created)
    await _say(created, "Can I come in at 4 today?")
    set_clock(TUESDAY_NOON + timedelta(minutes=5))
    await _staff_replied(created)  # staff answered
    set_clock(TUESDAY_NOON + timedelta(minutes=16))
    await followups.fire_due(_deps())
    assert (await _state(mongo, created))["status"] == "paused"


async def test_the_ai_switch_turned_off_by_staff_stays_off(mongo, dealer_with_hours):
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await handle_lead_paused(LeadPausedEvent(event_id="p-switch", dealer_id=DEALER, lead_id=created["lead_id"],
                                             reason="AI turned off for this lead by Betsy"), _deps())
    await _say(created, "Can I come in at 4 today?")
    assert await _quiet(mongo, created) == []


async def test_dont_text_me_with_a_vehicle_on_file_asks_about_vehicle_updates(mongo, dealer_with_hours):
    """Betsy, 22 Oct 2026: "Ok we will not text you again regarding this inquiry. Is it still ok to send updates
    regarding your current vehicle(s) on file (service & market values)? ..." - yes keeps them, this inquiry stays
    stopped; no stops texts entirely."""
    from upsell_agent.channels import consent
    from upsell_agent.compliance import opt_out
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await mongo["ai_lead_state"].insert_one({"lead_id": "owned", "dealer_id": DEALER, "customer_id": created["customer_id"],
                                             "stage": "sold_delivered"})
    await _say(created, "Please stop texting me about this car")
    assert await _last_sms(mongo, created) == (
        f"{opt_out.INQUIRY_CONFIRMATION.format(verb='text')} {opt_out.VEHICLE_UPDATES_QUESTION}")
    await _say(created, "Yes")
    assert await _last_sms(mongo, created) == opt_out.VEHICLE_UPDATES_YES
    state = await _state(mongo, created)
    assert state["inquiry_opt_out"]["sms"] and "vehicle_updates_question" not in state
    assert not await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")
    assert not await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one(
        {"lead_id": created["lead_id"], "kind": "cadence_touch", "status": "pending"})


async def test_no_to_vehicle_updates_stops_texts_entirely(mongo, dealer_with_hours):
    from upsell_agent.channels import consent
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await mongo["deals"].insert_one({"dealer_id": DEALER, "customer_id": created["customer_id"], "deal_number": "D1",
                                     "vin": "1HGCM82633A004352"})  # a DealerVault deal counts as a vehicle on file
    await _say(created, "don't text me anymore")
    assert "vehicle(s) on file" in await _last_sms(mongo, created)
    await _say(created, "no")
    assert await _last_sms(mongo, created) == "Understood, we won't text you again."
    assert await consent.is_opted_out(dealer_scoped_db(DEALER), created["customer_id"], "sms")


async def test_no_vehicle_with_us_gets_only_the_inquiry_confirmation(mongo, dealer_with_hours):
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await _say(created, "Please stop texting me")
    assert await _last_sms(mongo, created) == "Ok, we will not text you again regarding this inquiry."


async def test_a_stopped_inquiry_gets_a_staff_note_and_a_new_inquiry_runs_with_a_note(mongo, dealer_with_hours):
    """The user, 28 Oct 2026 (Brian Rosenberg: "Please stop texting I'm no longer interested" - the lead stayed open with
    no note): staff get a note; a new inquiry from him isn't swallowed by the stopped lead and carries a note too."""
    from upsell_agent.events.handlers import handle_lead_created
    from upsell_agent.events.models import LeadCreatedEvent
    from upsell_agent.scheduler.reconcile import note_stopped_inquiries
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await _say(created, "Please stop texting I'm no longer interested")
    notes = await mongo["ai_crm_notes"].find({"lead_id": created["lead_id"]}).to_list(None)
    assert [n["kind"] for n in notes] == ["inquiry_stopped"] and notes[0]["status"] == "written"
    assert "Please stop texting I'm no longer interested" in notes[0]["text"]
    # Betsy, 28 Oct 2026 meeting: an opt-out never closes the lead.
    assert (await _state(mongo, created)).get("crm_status_sync", {}).get("crm_status") != "Closed - Lost"
    assert "No more texts and emails" in notes[0]["text"] and "stays open" in notes[0]["text"]
    assert await note_stopped_inquiries() == 0  # already written: the start-up backfill adds nothing

    again = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Maria Test",
                                       comments="Is the Camry still there?", customer_id=created["customer_id"])
    result = await handle_lead_created(LeadCreatedEvent(event_id=again["lead_id"], dealer_id=DEALER,
                                                        lead_id=again["lead_id"], customer_id=again["customer_id"],
                                                        channel="sms"), _deps())
    assert result.get("status") != "duplicate"
    assert "duplicate_of" not in (await _state(mongo, again))
    note = await mongo["ai_crm_notes"].find_one({"lead_id": again["lead_id"], "kind": "earlier_inquiry_stopped"})
    assert note and created["lead_id"] in note["text"] and "no longer interested" in note["text"]


async def test_the_backfill_notes_a_lead_stopped_before_the_note_existed(mongo, dealer_with_hours):
    from upsell_agent.scheduler.reconcile import note_stopped_inquiries
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await mongo[AI_LEAD_STATE_COLLECTION].update_one({"lead_id": created["lead_id"]}, {"$set": {
        "dealer_id": DEALER, "inquiry_opt_out.sms": {"at": clock.now(), "said": "stop texting me"}}})
    assert await note_stopped_inquiries() == 1
    assert await note_stopped_inquiries() == 0


async def test_i_can_come_at_a_time_books_it(mongo, dealer_with_hours):
    """Client, 20 Oct 2026 (Betsy: "the customer says I can come at 7 and ai abandons")."""
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await _say(created, "I can come in at 4")
    state = await _state(mongo, created)
    assert state["stage"] == "appointment_set", await _last_sms(mongo, created)


async def test_a_reply_never_ends_with_nothing(mongo):
    """Client, 20-21 Oct 2026 (live: 68 of ~145 replies were "acknowledge", e.g. "Ok thanks" -> "I'm here ... when
    you're ready"): short answers after an offer get the times again or a fresh offer, never a dead end."""
    from tests.unit.test_turn_pipeline import _lead as _pipeline_lead
    from tests.unit.test_turn_pipeline import _turn
    created = await _pipeline_lead(comments="Looking for a new Toyota RAV4")
    await _turn(created, "Looking for a new Toyota RAV4", trigger="lead_created")
    outcomes = [(await _turn(created, said))["outcome"] for said in (
        "My budget is $35,000 and I'd like to buy this month", "ok thanks", "cool", "ok", "thanks", "sounds good")]
    assert "acknowledge" not in outcomes and outcomes.count("offer_visit") >= 4, outcomes


async def test_yes_on_the_delivered_vehicles_own_lead_keeps_its_updates_coming(mongo, dealer_with_hours):
    """Review 23 Oct 2026: the stopped inquiry is the Sold - Delivered lead itself - its yes must not leave the
    updates it agreed to blocked."""
    set_clock(TUESDAY_NOON)
    created = await _lead()
    await mongo["ai_lead_state"].update_one({"lead_id": created["lead_id"]},
                                            {"$set": {"stage": "sold_delivered", "sold_delivered_at": TUESDAY_NOON}},
                                            upsert=True)
    await _say(created, "please stop texting me")
    assert "vehicle(s) on file" in await _last_sms(mongo, created)
    await _say(created, "yes")
    assert not (await _state(mongo, created)).get("inquiry_opt_out")


def test_the_morning_message_as_betsy_wrote_it_names_the_agent_and_the_dealership(monkeypatch):
    # Mziuki, 26 Oct 2026: "This is {agent_name} with {dealership}." went out as "This is with."
    from upsell_agent import ai_studio
    from upsell_agent.agent.nodes import decide

    betsy = {"mode": "fixed", "text": "Good morning, {first_name}. This is {agent_name} with {dealership}.  I will be "
                                      "happy to help you pick up where we left off.  Tell me, what are you driving now?"}
    monkeypatch.setattr(ai_studio, "message", lambda section, key: betsy if key == "after_hours_resume" else None)
    decision = {"action": "answer", "after_hours": {"mode": "resume"}}
    dealer = SimpleNamespace(name="Victory Cars Central", agent_name="Nicole", phone=None, address=None)
    decide.studio_after_hours(decision, "Mziuki Mziuki", dealer)
    assert decision["cannot_supply"]["text"] == ("Good morning, Mziuki. This is Nicole with Victory Cars Central. I will "
                                                 "be happy to help you pick up where we left off. Tell me, what are you "
                                                 "driving now?")


async def test_no_after_hours_choice_in_a_conversation_already_going(mongo, monkeypatch):
    # Robinsson Castro, 26 Oct 2026: booked at 8:00 PM, then "Good" got "chat now or during business hours?".
    from types import SimpleNamespace
    from upsell_agent.agent.nodes import decide
    from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION
    now = clock.now()
    await mongo[AI_MESSAGES_COLLECTION].insert_one({"lead_id": "L1", "direction": "outbound", "status": "sent",
                                                    "created_at": now - timedelta(minutes=2), "dealer_id": "D1"})
    state = SimpleNamespace(dealer_id="D1", lead_id="L1")
    assert await decide._conversation_ongoing(SimpleNamespace(lead_state={}), state, now)
    assert not await decide._conversation_ongoing(SimpleNamespace(lead_state={}), SimpleNamespace(
        dealer_id="D1", lead_id="L2"), now)
    assert await decide._conversation_ongoing(SimpleNamespace(lead_state={"stage": "appointment_set"}), SimpleNamespace(
        dealer_id="D1", lead_id="L2"), now)


async def _email_only_lead(mongo):
    from upsell_agent.integrations.mongodb import PLATFORM_LEADS_COLLECTION, PLATFORM_CUSTOMERS_COLLECTION, as_object_id
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="email", name="Latina Neal",
                                         comments="Interested in the 2023 Chevrolet Camaro")
    await mongo[PLATFORM_LEADS_COLLECTION].update_one({"_id": as_object_id(created["lead_id"])}, {"$set": {"phone": "N/A"}})
    await mongo[PLATFORM_CUSTOMERS_COLLECTION].update_one({"_id": as_object_id(created["customer_id"])},
                                                          {"$set": {"phones": []}})
    return created


async def _email_reply(created, text):
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="email",
                                text=text, received_at=clock.now())
    return await handle_inbound_message(event, _deps())


async def _last_decision(mongo, created):
    turn = (await mongo["ai_turn_log"].find({"lead_id": created["lead_id"], "trigger": "inbound_message"})
            .sort("_id", -1).to_list(1))[0]
    return next(n for n in turn["nodes"] if n["node"] == "decide")["output"]


async def test_no_phone_on_the_lead_the_mobile_number_is_offered(mongo, dealer_with_hours):
    """The user, 29 Oct 2026 (Latina Neal and others: no phone, and the AI never asked): asked like the email."""
    set_clock(TUESDAY_NOON)
    created = await _email_only_lead(mongo)
    await _email_reply(created, "Thanks Nicole, the details look good.")
    decision = await _last_decision(mongo, created)
    assert decision.get("ask_phone") is True
    assert decision["asks"][0]["requirement"] == "customer_phone"


async def test_a_customer_who_prefers_email_is_never_asked_for_a_phone(mongo, dealer_with_hours):
    set_clock(TUESDAY_NOON)
    created = await _email_only_lead(mongo)
    await _email_reply(created, "Email is my preferred method of communication. Thanks for the details.")
    assert not (await _last_decision(mongo, created)).get("ask_phone")


async def test_stop_and_not_interested_stops_both_channels(mongo, dealer_with_hours):
    """The user, 31 Oct 2026: "stop, I'm not interested" stops texts and emails; "stop texting" stops texts only."""
    set_clock(TUESDAY_NOON)
    no = await _lead()
    await _say(no, "Please stop texting I'm no longer interested")
    assert set((await _state(mongo, no))["inquiry_opt_out"]) >= {"sms", "email"}
    only = await _lead(comments="Hi, I want a new Toyota Camry")
    await _say(only, "Please stop texting me")
    assert "email" not in (await _state(mongo, only))["inquiry_opt_out"]
