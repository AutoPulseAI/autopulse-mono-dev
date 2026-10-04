"""MASTER_PLAN_2 Phase 5, conversational Decide: answer first, then at most
two follow-ups; two asks per message (MASTER_PLAN_3 Bq); never the same thing twice in a row;
parked after two asks; partly qualified when everything missing is parked;
nothing asked of a frustrated customer."""

import itertools
import re
from datetime import UTC, datetime

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from tests.unit.test_slots import SALES_ALL, _fact, _profile
from upsell_agent.agent.conversation import ConversationState, after_turn
from upsell_agent.agent.nodes.guard import unanswered_questions
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.slots.policy import Flags, next_action

# MASTER_PLAN_3 B1: these first replies are the in-hours kind.
pytestmark = pytest.mark.usefixtures("during_opening_hours")

DEALER = simulate.DEV_DEALERS[0]["_id"]
Q = {"text": "Is it AWD?", "label": "answerable"}
ABOUT_ME = {"text": "what do you know about me?", "label": "about_me"}
CLARIFY = {"text": "what do you mean", "label": "clarify"}


def _decide(*facts, **flags):
    return next_action(_profile(LeadType.SALES, *facts), Flags(**flags))


# --- Rule order and follow-ups ---------------------------------------------------------

def test_clarify_beats_answer():
    decision = _decide(questions=[CLARIFY, Q], last_asked=["interest.timeline"])
    assert decision["action"] == "clarify"
    assert decision["clarify"]["items"][0]["path"] == "interest.timeline"
    assert decision["answer_questions"] == [CLARIFY, Q]  # the other question is answered too
    assert decision["asks"] == [] and decision["slots"] == []


def test_clarify_with_nothing_asked_yet_is_just_answered():
    assert _decide(questions=[CLARIFY])["action"] == "answer"


def test_answer_then_two_asks():
    decision = _decide(questions=[ABOUT_ME])
    assert decision["action"] == "answer" and decision["answer_questions"] == [ABOUT_ME]
    assert [a["requirement"] for a in decision["asks"]] == ["interest.new_or_used", "interest.model"]


def test_answer_then_confirm_rather_than_a_new_ask():
    decision = _decide(*SALES_ALL[:4], _fact("trade_in.has_trade", False, pending=True), questions=[Q])
    assert decision["action"] == "answer" and decision["confirm"]["path"] == "trade_in.has_trade"
    assert decision["asks"] == []


def test_answer_beats_confirm():
    assert _decide(_fact("interest.budget", 30000, pending=True), questions=[Q])["action"] == "answer"
    assert _decide(_fact("interest.budget", 30000, pending=True))["action"] == "confirm"


def test_frustrated_customer_is_asked_nothing():
    with_question = _decide(questions=[Q], annoyed_at_bot=True)
    assert with_question["action"] == "answer" and with_question["asks"] == []
    without = _decide(annoyed_at_bot=True)
    assert without["action"] == "acknowledge" and without["asks"] == [] and without["annoyed_at_bot"]


# --- Ask limits ------------------------------------------------------------------------

def test_never_the_same_detail_twice_in_a_row():
    decision = _decide(last_asked=["interest.new_or_used"], asks={"interest.new_or_used": (1, 1)}, replies=1)
    assert decision["action"] == "ask" and decision["slots"] == ["interest.model", "interest.budget",
                                                                 "interest.monthly_payment"]
    assert {"label": "New or used", "why": "asked in our last message"} in decision["not_asked"]


def test_asked_twice_is_parked_then_asked_again_after_three_other_replies():
    history = {"interest.new_or_used": (2, 3)}
    parked = _decide(asks=history, replies=4, last_asked=["interest.model"])
    assert parked["slots"] == ["interest.budget", "interest.monthly_payment", "interest.timeline"]
    assert any(n["why"].startswith("parked") for n in parked["not_asked"])
    # Once every other detail has had its asks, the cooled-down one comes back.
    everyone = {"interest.new_or_used": (2, 3), "interest.budget": (2, 4), "interest.monthly_payment": (2, 4),
                "interest.timeline": (2, 5), "trade_in.has_trade": (2, 6), "interest.model": (1, 7)}
    back = _decide(asks=everyone, replies=7, last_asked=["interest.model"])
    assert back["action"] == "ask" and back["slots"] == ["interest.new_or_used"]


def test_least_asked_detail_comes_first():
    decision = _decide(asks={"interest.new_or_used": (1, 1), "interest.model": (1, 2)}, replies=2, last_asked=[])
    assert decision["slots"] == ["interest.budget", "interest.monthly_payment", "interest.timeline"]


def test_everything_missing_parked_means_partly_qualified():
    asks = {p: (2, 5) for p in ("interest.budget", "interest.monthly_payment", "interest.timeline",
                                "trade_in.has_trade")}
    decision = _decide(*SALES_ALL[:2], asks=asks, replies=6)
    assert decision["action"] == "partly_qualified" and decision["asks"] == []
    # Still partly qualified once the cooldown has passed: asked out means asked twice.
    assert _decide(*SALES_ALL[:2], asks=asks, replies=20)["action"] == "partly_qualified"
    # One detail asked only once keeps the conversation going.
    once = {**asks, "interest.timeline": (1, 5)}
    assert _decide(*SALES_ALL[:2], asks=once, replies=6, last_asked=[])["slots"] == ["interest.timeline"]


def test_partly_qualified_lead_is_asked_nothing_more():
    decision = _decide(*SALES_ALL[:2], stop_asking=True)
    assert decision["action"] == "acknowledge" and decision["asks"] == []
    assert _decide(*SALES_ALL[:2], stop_asking=True, questions=[Q])["asks"] == []


def test_only_detail_left_was_just_asked_means_acknowledge():
    decision = _decide(*SALES_ALL[:4], last_asked=["trade_in.has_trade"], asks={"trade_in.has_trade": (1, 4)},
                       replies=4)
    assert decision["action"] == "acknowledge"


def test_already_qualified_lead_is_acknowledged_not_requalified():
    assert _decide(*SALES_ALL)["action"] == "qualified"
    assert _decide(*SALES_ALL, already_qualified=True)["action"] == "acknowledge"


# --- Guard: a reply meant to answer must answer ------------------------------------------

def test_guard_sends_back_a_reply_that_skipped_a_question():
    decision = {"action": "answer", "answer_questions": [Q, ABOUT_ME]}
    assert unanswered_questions(decision, {"answered_questions": ["Is it AWD?"]}) == ["what do you know about me?"]
    assert unanswered_questions(decision, {"answered_questions": ["is it awd", "What do you know about me"]}) == []
    assert unanswered_questions({"action": "ask", "answer_questions": [Q]}, {}) == []


# --- Conversation state ------------------------------------------------------------------

def test_clarify_doesnt_count_as_asking_again():
    state = ConversationState(turn=1, last_asked=["interest.timeline"])
    after = after_turn(state, now=datetime.now(UTC), send_status="sent", shadow=False, action="clarify",
                       asked_slots=[], answered=["what do you mean"],
                       new_questions=[CLARIFY], used_template=False, promises=[])
    assert after.last_asked == ["interest.timeline"] and after.asks == {} and after.open_questions == []


# --- Through real turns --------------------------------------------------------------------

def _deps() -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), store_prompts=True,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(comments="Hi, I saw your ad"):
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Dana Decide",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text):
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=datetime.now(UTC)), _deps())


async def _turns(mongo, created):
    return await mongo[AI_TURN_LOG_COLLECTION].find(
        {"lead_id": created["lead_id"], "trigger": {"$in": ["lead_created", "inbound_message"]}}
    ).sort("created_at", 1).to_list(None)


async def _last_sms(mongo, created):
    rows = await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]}).sort("created_at", -1).to_list(1)
    return rows[0]["text"]


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")  # PLAN_4 stream X1: a first reply waits for the customer's window
async def test_what_do_you_know_about_me_is_answered_then_one_ask(mongo):
    created = await _lead(comments="Interested in a used Ford F-150")
    await _say(created, "so far what do u know about me?")
    turn = (await _turns(mongo, created))[-1]
    assert turn["outcome"] == "answer"
    reply = await _last_sms(mongo, created)
    assert "Here's what I have so far" in reply and "used" in reply and "Ford F-150" in reply
    assert reply.count("?") == 1  # exactly one follow-up question
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["open_questions"] == []


async def test_dodging_customer_is_never_asked_the_same_thing_twice_in_a_row(mongo):
    created = await _lead()
    for _ in range(14):
        await _say(created, "hmm")
    turns = await _turns(mongo, created)
    asked = [set(t["summary"]["asked"]) for t in turns]
    for before, after in itertools.pairwise(asked):
        assert not (before & after), f"asked {before & after} twice in a row"
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "partly_qualified"
    assert all(a.get("count", 0) <= 3 for a in state["conversation"]["asks"].values())
    # Once handed on, nothing more is asked.
    await _say(created, "ok")
    last = (await _turns(mongo, created))[-1]
    assert last["outcome"] == "acknowledge" and last["summary"]["asked"] == []


async def test_frustrated_customer_gets_an_apology_and_no_question(mongo):
    created = await _lead()
    result = await _say(created, "You keep asking the same thing!")
    assert result["outcome"] == "acknowledge"
    reply = await _last_sms(mongo, created)
    assert "?" not in reply and "won't keep asking" in reply
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["status"] == "active"


@pytest.mark.usefixtures("during_opening_hours", "ny_customer")  # PLAN_4 stream X1: a first reply waits for the customer's window
async def test_clarify_re_explains_and_asks_the_same_question_again(mongo):
    created = await _lead()
    asked_first = (await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}))[
        "conversation"]["last_asked"]
    result = await _say(created, "what do you mean")
    assert result["outcome"] == "clarify"
    reply = await _last_sms(mongo, created)
    # The first reply asked two things (MASTER_PLAN_3 Bq): one detail, plus Touch 1's own closing question
    # (MASTER_PLAN_3 C4). Both are explained and asked again.
    assert asked_first == ["interest.new_or_used", "trade_in.has_trade"]
    assert reply.startswith("Sorry, I should have been clearer")
    # MASTER_PLAN_2 Phase 7: the slot's own explanation, then the same question - nothing new.
    assert "New means nobody has owned it before" in reply and "Are you looking for a new or a used vehicle?" in reply
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["last_asked"] == asked_first


@pytest.mark.parametrize("question", ["How much is the RAV4?", "Can you tell me a joke?"])
async def test_every_question_is_answered_and_closed(mongo, question):
    created = await _lead()
    result = await _say(created, question)
    assert result["outcome"] == "answer"
    turn = (await _turns(mongo, created))[-1]
    guard = next(n for n in turn["nodes"] if n["node"] == "guard")
    assert guard["output"]["checks"]["answers_the_questions"]
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["conversation"]["open_questions"] == []
    if "How much" in question:
        assert [p["text"] for p in state["conversation"]["promises"]] == [f"The team will confirm: {question}"]
    else:
        assert re.search(r"only help with your vehicle", await _last_sms(mongo, created))
