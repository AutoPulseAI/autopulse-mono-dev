"""MASTER_PLAN_2 Phase 1: the context pack, conversation state and the
dealer's profile (timezone, hours) - the pieces alone, then wired through
real turns."""

from datetime import UTC, datetime, time, timedelta

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent.agent.context_pack import (
    MAX_MESSAGE_CHARS,
    MIN_RECENT,
    TRIMMED,
    PackMessage,
    build_pack,
    clean_email_text,
    estimate_tokens,
    select_working_memory,
)
from upsell_agent.agent.conversation import (
    MAX_OPEN_QUESTIONS,
    ConversationState,
    after_turn,
    load_conversation,
    questions_for_turn,
)
from upsell_agent.agent.nodes.compose import compose_payload
from upsell_agent.agent.nodes.extract import extract_payload
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.dealer_profile import (
    DEFAULT_HOURS,
    DEFAULT_TIMEZONE,
    dealer_profile,
    parse_hours,
    parse_time,
    resolve_timezone,
)
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_USERS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

# MASTER_PLAN_3 B1: these first replies are the in-hours kind.
pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]
NOW = datetime(2026, 9, 22, 15, 0, tzinfo=UTC)


def _msg(direction: str, text: str, channel: str = "sms") -> PackMessage:
    return PackMessage(direction=direction, channel=channel, text=text)


# --- Cleaning customer email ----------------------------------------------------

def test_gmail_reply_header_and_quote_removed():
    text = ("Yes, a 2019 Civic.\n\nOn Mon, Sep 21, 2026 at 10:00 AM Sunrise Motors <sales@x.test> wrote:\n"
            "> What year is your trade-in? Is your budget $40,000?\n> Thanks")
    assert clean_email_text(text) == "Yes, a 2019 Civic."


def test_gmail_header_wrapped_over_two_lines():
    text = "Sounds good\n\nOn Mon, Sep 21, 2026 at 10:00 AM Sunrise Motors <sales@sunrise.test>\nwrote:\n> old"
    assert clean_email_text(text) == "Sounds good"


def test_outlook_blocks_signature_and_device_line_removed():
    assert clean_email_text("Tuesday works\n-----Original Message-----\nFrom: Dealer\nSent: Monday") == "Tuesday works"
    assert clean_email_text("Tuesday works\n\nFrom: Sunrise Motors\nSent: Monday, 2pm\nTo: me\n\nold text") == "Tuesday works"
    assert clean_email_text("Tuesday works\n--\nJane Doe\nACME Corp") == "Tuesday works"
    assert clean_email_text("Tuesday works\n\nSent from my iPhone") == "Tuesday works"


def test_a_fully_quoted_email_keeps_its_text():
    assert clean_email_text("> only quoted") == "> only quoted"


# --- Working memory budget -------------------------------------------------------

def test_budget_keeps_newest_and_drops_oldest():
    history = [_msg("inbound" if i % 2 else "outbound", f"message number {i} " + "x" * 400) for i in range(20)]
    kept, used = select_working_memory(history, budget_tokens=1500)
    assert kept == history[-len(kept):]  # a suffix, oldest first
    assert MIN_RECENT <= len(kept) < 20
    assert used["used"] <= 1500 or len(kept) == MIN_RECENT


def test_last_messages_kept_even_over_budget():
    history = [_msg("inbound", "y" * 1600) for _ in range(10)]
    kept, used = select_working_memory(history, budget_tokens=10)
    assert len(kept) == MIN_RECENT
    assert used["used"] > 10


def test_long_message_is_cut():
    history = [_msg("inbound", "z" * (MAX_MESSAGE_CHARS + 500))]
    kept, used = select_working_memory(history, budget_tokens=3000)
    assert kept[0].text.endswith(TRIMMED) and len(kept[0].text) == MAX_MESSAGE_CHARS + len(TRIMMED)
    assert used["trimmed"] == 1


def test_pack_layers_and_budget():
    conversation = ConversationState(last_asked=["interest.timeline"])
    pack = build_pack(
        now_local=datetime(2026, 9, 22, 11, 5, tzinfo=UTC), dealer={"name": "Sunrise", "timezone": "America/New_York"},
        customer={"first_name": "Maria", "channel": "sms"}, lead_type="sales",
        profile={"slots": [{"label": "Budget", "path": "interest.budget", "value": 30000, "state": "filled",
                            "source": "customer", "quote": "30k"}]},
        new_messages=[_msg("inbound", "Next month probably")],
        history=[_msg("outbound", "When are you hoping to buy?"), _msg("inbound", "hi")],
        more_not_loaded=False, conversation=conversation, campaign=None, working_tokens=3000)
    assert pack.now == {"date": "2026-09-22", "weekday": "Tuesday", "time": "11:05", "timezone": "America/New_York"}
    assert pack.customer_text() == "Next month probably"
    assert pack.last_ai_message().text == "When are you hoping to buy?"
    assert pack.profile == [{"label": "Budget", "path": "interest.budget", "value": 30000, "display": "$30,000",
                             "state": "filled", "source": "customer"}]
    assert pack.about_customer == {"known": [{"label": "Budget", "value": "$30,000", "from": "you told us"}],
                                   "unconfirmed": []}
    assert pack.budget.kept == 2 and pack.budget.dropped == 0
    assert pack.budget.tokens["new_messages"] == estimate_tokens("Next month probably")
    assert "budget" not in pack.for_prompt()


# --- Conversation state ------------------------------------------------------------

def _after(state, **kw):
    args = {"now": NOW, "send_status": "sent", "shadow": False, "action": "ask", "asked_slots": [],
            "answered": [], "new_questions": [], "used_template": False, "promises": []}
    return after_turn(state, **{**args, **kw})


def test_asks_are_counted_per_reply():
    state = _after(ConversationState(), asked_slots=["interest.model"])
    state = _after(state, asked_slots=["interest.model", "interest.timeline"])
    assert state.turn == 2
    assert state.asks["interest.model"].count == 2 and state.asks["interest.model"].last_turn == 2
    assert state.asks["interest.timeline"].count == 1
    assert state.last_asked == ["interest.model", "interest.timeline"]
    assert state.last_topic == "ask: interest.model, interest.timeline"


def test_question_closed_by_an_ai_reply_that_answered_it():
    state = _after(ConversationState(), action="answer", new_questions=["Is it AWD?", "Open Sunday?"],
                   answered=["Is it AWD?"])
    assert [q.text for q in state.open_questions] == ["Open Sunday?"]


def test_question_stays_open_after_a_template_reply():
    state = _after(ConversationState(), new_questions=["Is it AWD?"], answered=["Is it AWD?"],
                   used_template=True, asked_slots=["interest.new_or_used"])
    assert [q.text for q in state.open_questions] == ["Is it AWD?"]
    assert state.last_topic == "template reply: asked interest.new_or_used"
    assert questions_for_turn(state, ["is it awd"]) == [{"text": "Is it AWD?", "label": "answerable"}]  # no repeat
    assert questions_for_turn(state, [{"text": "Do you take trades?", "label": "restricted"}]) == [
        {"text": "Is it AWD?", "label": "answerable"}, {"text": "Do you take trades?", "label": "restricted"}]


def test_question_recorded_even_when_nothing_was_sent():
    state = _after(ConversationState(), send_status="suppressed", new_questions=["Open Sunday?"],
                   asked_slots=["interest.model"])
    assert [q.text for q in state.open_questions] == ["Open Sunday?"]
    assert state.turn == 0 and state.asks == {}


def test_promises_kept_without_repeats():
    state = _after(ConversationState(), promises=["The team will confirm the price."])
    state = _after(state, promises=["the team will confirm the price", "A member of the team will call."])
    assert [p.text for p in state.promises] == ["The team will confirm the price.", "A member of the team will call."]
    assert state.promises[1].turn == 2


def test_shadow_changes_nothing():
    before = ConversationState(turn=3)
    assert _after(before, shadow=True, asked_slots=["interest.model"], new_questions=["?"]) == before


def test_open_questions_are_capped():
    state = ConversationState()
    for i in range(MAX_OPEN_QUESTIONS + 3):
        state = _after(state, send_status="failed", used_template=True, new_questions=[f"Question {i}?"])
    assert len(state.open_questions) == MAX_OPEN_QUESTIONS
    assert state.open_questions[-1].text == f"Question {MAX_OPEN_QUESTIONS + 2}?"


def test_lead_from_before_phase_1_keeps_what_was_last_asked():
    assert load_conversation({"last_asked_slots": ["trade_in.year"]}).last_asked == ["trade_in.year"]
    assert load_conversation(None) == ConversationState()


# --- Dealer profile ------------------------------------------------------------------

def test_parse_time_formats():
    assert parse_time("9:00 AM") == time(9) and parse_time("6:30 PM") == time(18, 30)
    assert parse_time("12:00 AM") == time(0) and parse_time("12:15 pm") == time(12, 15)
    assert parse_time("09:00") == time(9) and parse_time("9 a.m.") == time(9)
    assert parse_time("") is None and parse_time("25:00") is None and parse_time("13:00 PM") is None


def test_parse_hours_from_the_platform_form():
    weekly = {"monday": {"active": True, "start": "8:30 AM", "end": "7:00 PM"},
              "tuesday": {"active": True, "start": "", "end": ""},
              "sunday": {"active": False, "start": "", "end": ""}}
    hours, from_record = parse_hours(weekly)
    assert from_record
    assert hours[0] == (time(8, 30), time(19)) and hours[1] == (time(9), time(18)) and hours[6] is None
    assert hours[2] is None  # not in the record = closed


def test_no_usable_hours_means_the_default():
    assert parse_hours(None) == (DEFAULT_HOURS, False)
    assert parse_hours({"monday": {"active": False}}) == (DEFAULT_HOURS, False)


def test_timezone_falls_back():
    assert resolve_timezone("America/Chicago") == "America/Chicago"
    assert resolve_timezone("Not/AZone") == DEFAULT_TIMEZONE and resolve_timezone(None) == DEFAULT_TIMEZONE


async def test_dealer_profile_reads_the_platform_record(mongo):
    await mongo[PLATFORM_USERS_COLLECTION].insert_one({"_id": ObjectId(DEALER), "name": "Sunrise Motors", "dealer_account_information": {
        "store_name": "Sunrise Motors of Springfield", "time_zone": "America/Chicago",
        "weekly_availability": {"saturday": {"active": True, "start": "10:00 AM", "end": "4:00 PM"}}}})
    profile = await dealer_profile(DEALER)
    assert profile.name == "Sunrise Motors of Springfield" and profile.timezone == "America/Chicago"
    assert profile.hours_from_record and profile.hours[5] == (time(10), time(16)) and profile.hours[0] is None
    assert profile.hours_view()["Saturday"] == "10:00-16:00"


# --- Wired through real turns --------------------------------------------------------

def _deps(**settings) -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV").model_copy(update=settings), sink=MemoryTraceSink(),
                    store_prompts=True, sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _new_lead(channel="sms", comments="Looking at a used Honda CR-V"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel=channel, name="Maria Test",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel=channel), _deps())
    return created


async def _reply(created, text, channel="sms", deps=None):
    event_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=event_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel=channel, message_id=event_id, text=text, received_at=datetime.now(UTC)), deps or _deps())


async def _turns(mongo, created):
    return await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]}).sort("created_at", 1).to_list(None)


def _node(turn, name):
    return next(n for n in turn["nodes"] if n["node"] == name and n.get("status") == "done")


async def test_second_turn_sees_the_first_reply_and_its_question(mongo):
    created = await _new_lead()
    await _reply(created, "Next month probably")
    first, second = await _turns(mongo, created)
    pack = _node(second, "load_context")["output"]["prompt"]["context_pack"]

    first_reply = _node(first, "send")["input"]["text"]
    assert [m["text"] for m in pack["working_memory"]] == [first_reply]
    assert pack["working_memory"][0]["direction"] == "outbound"
    assert [m["text"] for m in pack["new_messages"]] == ["Next month probably"]
    assert pack["conversation"]["turn"] == 1 and pack["conversation"]["last_asked"]
    assert pack["now"]["timezone"] == DEFAULT_TIMEZONE
    assert second["input"]["batch"][0]["text"] == "Next month probably"
    assert second["summary"]["batched"] == 1


async def test_extract_and_compose_read_the_same_pack(mongo):
    created = await _new_lead()
    await _reply(created, "Next month probably, is it AWD?")
    turn = (await _turns(mongo, created))[-1]
    pack = _node(turn, "load_context")["output"]["prompt"]["context_pack"]
    state = AgentState(dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
                       trigger="inbound_message", channel="sms", context_pack={**pack, "budget": {}},
                       customer_text="Next month probably, is it AWD?", decision={"action": "ask"})
    extract_context = extract_payload(state)["context"]
    compose_context = compose_payload(state)["context"]
    assert extract_context == compose_context
    assert extract_payload(state)["recently_asked"] == pack["conversation"]["last_asked"]


async def test_conversation_state_saved_after_each_turn(mongo):
    created = await _new_lead()
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    conversation = state["conversation"]
    assert conversation["turn"] == 1
    assert conversation["promises"] == []  # an ask with no question to answer promises nothing
    asked = conversation["last_asked"]
    assert asked and all(conversation["asks"][p]["count"] == 1 for p in asked)
    assert "last_asked_slots" not in state

    await _reply(created, "Is it AWD?")
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert [p["text"] for p in state["conversation"]["promises"]] == ["The team will confirm: Is it AWD?"]
    assert state["conversation"]["turn"] == 2


async def test_question_left_by_a_template_is_answered_next_turn(mongo):
    created = await _new_lead()
    # One AI call per turn: Extract uses it, Compose can't run, the template goes out.
    await _reply(created, "Do you take trades?", deps=_deps(max_ai_calls_per_turn=1))
    assert (await _turns(mongo, created))[-1]["outcome"] == "fallback"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert [q["text"] for q in state["conversation"]["open_questions"]] == ["Do you take trades?"]

    await _reply(created, "Next month")
    turn = (await _turns(mongo, created))[-1]
    assert [q["text"] for q in _node(turn, "decide")["output"]["answer_questions"]] == ["Do you take trades?"]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["open_questions"] == []


async def test_value_only_in_a_quoted_email_is_not_taken(mongo):
    created = await _new_lead(channel="email")
    await _reply(created, "Sounds good to me.\n\nOn Mon, Sep 21, 2026 at 10:00 AM Sunrise <s@x.test> wrote:\n"
                          "> Is your budget around $40,000 for a used Toyota RAV4?", channel="email")
    profile = await lead_profile(DEALER, created["lead_id"])
    slots = {s["path"]: s for s in profile["slots"]}
    assert slots["interest.budget"]["state"] != "filled"
    turn = (await _turns(mongo, created))[-1]
    assert _node(turn, "extract")["input"]["text"] == "Sounds good to me."


async def test_shadow_turn_leaves_conversation_state_alone(mongo):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Sam Shadow",
                                         comments="Used truck")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms", shadow=True), _deps())
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["turn"] == 0 and state["conversation"]["asks"] == {}


async def test_working_memory_excludes_unsent_drafts(mongo):
    created = await _new_lead()
    await mongo["ai_messages"].insert_one({
        "dealer_id": DEALER, "lead_id": created["lead_id"], "direction": "outbound", "channel": "sms",
        "text": "a suppressed draft", "status": "suppressed", "created_at": datetime.now(UTC) - timedelta(seconds=1)})
    await _reply(created, "ok")
    pack = _node((await _turns(mongo, created))[-1], "load_context")["output"]["prompt"]["context_pack"]
    assert "a suppressed draft" not in [m["text"] for m in pack["working_memory"]]
