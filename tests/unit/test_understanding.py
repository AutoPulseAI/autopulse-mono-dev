"""MASTER_PLAN_2 Phase 4, understanding the customer: short replies read
against what we asked last, every question labelled, and frustration with the
bot kept apart from being upset (only a clear signal hands off)."""

from datetime import UTC, datetime

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings
from upsell_agent.agent.nodes.extract import _allowed_slots
from upsell_agent.agent.nodes.validate import run_checks
from upsell_agent.agent.offline_model import extract
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.api.leads import lead_profile
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, AI_TURN_LOG_COLLECTION
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

DEALER = simulate.DEV_DEALERS[0]["_id"]


def _offline(text, asked=(), lead_type="sales"):
    return extract({"customer_text": text, "lead_type": lead_type, "allowed_slots": _allowed_slots(),
                    "recently_asked": list(asked)})


# --- Short replies ----------------------------------------------------------------------

@pytest.mark.parametrize(("text", "asked", "path", "value"), [
    ("used", ["interest.new_or_used"], "interest.new_or_used", "used"),
    ("yes", ["trade_in.has_trade"], "trade_in.has_trade", True),
    ("Nope", ["trade_in.has_trade"], "trade_in.has_trade", False),
    ("2019", ["trade_in.year"], "trade_in.year", 2019),
    ("82,000", ["trade_in.mileage"], "trade_in.mileage", 82000),
    ("about 60k", ["vehicle.mileage"], "vehicle.mileage", 60000),
    ("45k", ["interest.budget"], "interest.budget", 45000),
])
def test_short_reply_answers_what_we_asked(text, asked, path, value):
    result = _offline(text, asked)
    found = {v["path"]: v for v in result["values"]}
    assert found[path]["value"] == value
    # Validate's rule still holds: the quote is the customer's own words.
    assert run_checks(found[path], text)["checks"]["quote_found"]


@pytest.mark.parametrize("text", ["yes", "no", "2019", "82000"])
def test_short_reply_with_nothing_asked_fills_nothing(text):
    assert _offline(text)["values"] == []


def test_hedged_short_number_needs_confirming():
    [value] = _offline("about 60k", ["trade_in.mileage"])["values"]
    assert value["confidence"] < 0.7


def test_short_number_goes_to_the_slot_it_fits():
    values = _offline("82000", ["trade_in.year", "trade_in.mileage"])["values"]
    assert [(v["path"], v["value"]) for v in values] == [("trade_in.mileage", 82000)]


# --- Question labels ---------------------------------------------------------------------

@pytest.mark.parametrize(("text", "label"), [
    ("so far what do u know about me?", "about_me"),
    ("What do you have on file for me?", "about_me"),
    ("what do you mean", "clarify"),
    ("What's that?", "clarify"),
    ("How much is it?", "restricted"),
    ("Can I get financing?", "restricted"),
    ("Is the blue one still available?", "restricted"),
    ("Can you tell me a joke?", "off_topic"),
    ("Is it AWD?", "answerable"),
    ("When are you open on Saturday?", "answerable"),
])
def test_question_labels(text, label):
    assert _offline(text)["questions"] == [{"text": text, "label": label}]


# --- Sentiment -------------------------------------------------------------------------

@pytest.mark.parametrize(("text", "upset", "confident", "at_bot"), [
    ("You keep asking the same thing!", False, False, True),
    ("That's not what I asked. Just answer my question", False, False, True),
    ("I'm annoyed, you keep asking me the same question", False, False, True),
    ("This is ridiculous, worst service ever", True, True, False),
    ("I'm a bit disappointed", True, False, False),
    ("Sounds good, thanks", False, False, False),
])
def test_upset_versus_annoyed_at_the_bot(text, upset, confident, at_bot):
    result = _offline(text)
    assert result["upset"] is upset and (result["upset_confidence"] >= 0.8) is confident
    assert result["annoyed_at_bot"] is at_bot


# --- Through real turns -------------------------------------------------------------------

def _deps(**settings) -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV").model_copy(update=settings), sink=MemoryTraceSink(),
                    store_prompts=True, sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead(lead_type="sales", comments="Hi there"):
    created = await simulate.create_lead(DEALER, lead_type=lead_type, channel="sms", name="Uma Understand",
                                         comments=comments)
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text, deps=None):
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=datetime.now(UTC)), deps or _deps())


async def _slots(created):
    return {s["path"]: s for s in (await lead_profile(DEALER, created["lead_id"]))["slots"]}


async def _asked(mongo, created):
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    return state["conversation"]["last_asked"]


async def test_short_answer_fills_the_slot_we_asked_for(mongo):
    created = await _lead(lead_type="trade_in", comments="Thinking about trading my car")
    asked = await _asked(mongo, created)
    assert "trade_in.year" in asked
    await _say(created, "2019")
    slot = (await _slots(created))["trade_in.year"]
    assert slot["state"] == "filled" and slot["value"] == 2019 and slot["quote"] == "2019"


async def test_labels_are_kept_on_open_questions(mongo):
    created = await _lead()
    # One AI call: Extract runs, Compose can't, so the template leaves the question open.
    await _say(created, "How much is the RAV4?", _deps(max_ai_calls_per_turn=1))
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert [(q["text"], q["label"]) for q in state["conversation"]["open_questions"]] == [
        ("How much is the RAV4?", "restricted")]
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    extract_node = next(n for n in turn["nodes"] if n["node"] == "extract")
    assert 'Question (restricted): "How much is the RAV4?"' in extract_node["reasoning"]


async def test_frustration_with_the_bot_is_not_a_handoff(mongo):
    created = await _lead()
    result = await _say(created, "You keep asking the same thing!")
    assert result["outcome"] != "handoff"
    assert (await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]}))["status"] == "active"


async def test_mild_upset_alone_is_not_a_handoff(mongo):
    created = await _lead()
    result = await _say(created, "I'm a bit disappointed")
    assert result["outcome"] != "handoff"
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    decide = next(n for n in turn["nodes"] if n["node"] == "decide")
    assert any("not clearly enough to hand off" in line for line in decide["reasoning"])


async def test_clearly_upset_customer_is_handed_off(mongo):
    created = await _lead()
    result = await _say(created, "This is ridiculous, worst service ever")
    assert result["outcome"] == "handoff"
