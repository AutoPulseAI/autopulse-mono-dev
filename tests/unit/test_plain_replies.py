"""MASTER_PLAN_2 Phase 7, plain and explainable replies: every detail we ask
for has plain customer wording and an explanation, internal terms never reach
a customer, and "what do you mean?" gets the same question explained."""

from types import SimpleNamespace

import pytest

from tests.unit.test_slots import _profile
from upsell_agent.agent.nodes.guard import guard
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.guardrails.draft_guard import _claims
from upsell_agent.guardrails.plain_language import READING_GRADE_TARGET, find_jargon, reading_grade
from upsell_agent.observability.trace import MemoryTraceSink, NodeSpan, TurnTracer
from upsell_agent.slots.policy import Flags, next_action
from upsell_agent.slots.schema import SLOTS

ASKED = [s for s in SLOTS if s.priority is not None]


@pytest.mark.parametrize("slot", ASKED, ids=[s.path for s in ASKED])
def test_every_asked_detail_has_plain_wording(slot):
    assert slot.customer_question.count("?") == 1 and slot.explanation  # one question
    for text in (slot.customer_question, slot.explanation):
        assert _claims(text) == [], "the guard would call these numbers invented"
        assert find_jargon(text) == []
        assert reading_grade(text) <= READING_GRADE_TARGET, (text, reading_grade(text))


@pytest.mark.parametrize(("text", "terms"), [
    ("What's your interest.timeline?", ["interest.timeline"]),
    ("Your timeline is this_week.", ["this_week"]),
    ("I need to fill a slot about your lead type.", ["slot", "lead type"]),
    ("Email us at sales_team@dealer.test or see https://dealer.test/new_cars", []),
    ("Are you looking for a new or a used vehicle?", []),
])
def test_find_jargon(text, terms):
    assert find_jargon(text) == terms


def test_reading_grade_orders_texts_sensibly():
    simple = "Are you looking for a new or a used car?"
    dense = ("Considering the aforementioned considerations, we'd appreciate clarification regarding your "
             "anticipated acquisition timeframe and financing preferences.")
    assert reading_grade(simple) < READING_GRADE_TARGET < reading_grade(dense)


async def test_guard_sends_back_a_draft_with_internal_terms():
    state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", customer_text="hi",
                       draft={"sms_text": "Thanks! What's your interest.timeline?", "email_subject": "Hi",
                              "email_body": "Thanks! What's your interest.timeline?"})
    tracer = TurnTracer(sink=MemoryTraceSink(), dealer_id="d", lead_id=None, customer_id="c", trigger="t",
                        channel="sms", store_prompts=False)
    result = (await guard(state, NodeSpan(), SimpleNamespace(tracer=tracer)))["guard_result"]
    assert not result["passed"] and not result["checks"]["plain_language"]
    assert result["next"] == "compose"  # one rewrite
    assert "interest.timeline" in result["violations"][-1]


def test_clarify_explains_a_shared_question_once():
    decision = next_action(_profile(LeadType.TRADE_IN), Flags(
        questions=[{"text": "what do you mean", "label": "clarify"}],
        last_asked=["trade_in.year", "trade_in.make", "trade_in.model"]))
    assert decision["action"] == "clarify"
    [item] = decision["clarify"]["items"]
    assert item["question"] == "What year, make and model is your trade-in?" and "Honda Civic" in item["explanation"]


def test_asks_carry_the_customer_wording():
    [ask] = next_action(_profile(LeadType.SALES), Flags())["asks"]
    assert ask["question"] == "Are you looking for a new or a used vehicle?"
    assert ask["explanation"].startswith("New means")
