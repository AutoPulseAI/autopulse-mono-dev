"""MASTER_PLAN_3 Bq (architecture §15 decision 35): at most two questions per
message. Decide gives Compose up to two asks, least-asked first then by
priority; a confirmation counts as one of the two; every other asking rule is
unchanged; the Guard sends back a draft with more than two questions."""

from types import SimpleNamespace

from tests.unit.test_slots import SALES_ALL, _fact, _profile
from upsell_agent.agent.nodes.compose import compose_payload
from upsell_agent.agent.nodes.guard import guard, too_many_questions
from upsell_agent.agent.offline_model import compose as offline_compose
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.observability.trace import MemoryTraceSink, NodeSpan, TurnTracer
from upsell_agent.slots.policy import MAX_ASKS_PER_MESSAGE, Flags, next_action

Q = {"text": "Is it AWD?", "label": "answerable"}


def _decide(*facts, **flags):
    return next_action(_profile(LeadType.SALES, *facts), Flags(**flags))


def _asked(decision):
    return [a["requirement"] for a in decision["asks"]]


def test_the_limit_is_two():
    assert MAX_ASKS_PER_MESSAGE == 2


def test_two_asks_in_priority_order():
    assert _asked(_decide()) == ["interest.new_or_used", "interest.model"]


def test_two_asks_least_asked_first():
    decision = _decide(asks={"interest.new_or_used": (1, 1)}, replies=2, last_asked=[])
    assert _asked(decision) == ["interest.model", "interest.budget_or_payment"]


def test_one_ask_when_only_one_detail_is_missing():
    decision = _decide(*SALES_ALL[:4])
    assert decision["action"] == "ask" and _asked(decision) == ["trade_in.has_trade"]


def test_no_asks_for_a_frustrated_customer():
    assert _decide(annoyed_at_bot=True)["asks"] == []
    assert _decide(questions=[Q], annoyed_at_bot=True)["asks"] == []


def test_never_re_asks_what_our_last_message_asked():
    decision = _decide(last_asked=["interest.new_or_used", "interest.model"],
                       asks={"interest.new_or_used": (1, 1), "interest.model": (1, 1)}, replies=1)
    assert _asked(decision) == ["interest.budget_or_payment", "interest.timeline"]


def test_answer_then_two_asks():
    decision = _decide(questions=[Q])
    assert decision["action"] == "answer" and _asked(decision) == ["interest.new_or_used", "interest.model"]


def test_answer_then_a_confirmation_and_one_ask():
    decision = _decide(*SALES_ALL[:2], _fact("interest.budget", 30000, pending=True), questions=[Q])
    assert decision["action"] == "answer" and decision["confirm"]["path"] == "interest.budget"
    # The budget requirement is being confirmed, so it isn't asked as well.
    assert _asked(decision) == ["interest.timeline"]


def test_confirm_plus_one_ask():
    decision = _decide(*SALES_ALL[:2], _fact("interest.budget", 30000, pending=True))
    assert decision["action"] == "confirm" and decision["confirm"]["path"] == "interest.budget"
    assert _asked(decision) == ["interest.timeline"]
    assert decision["slots"] == ["interest.budget", "interest.timeline"]


def test_confirm_alone_when_nothing_else_is_missing():
    decision = _decide(*SALES_ALL[:4], _fact("trade_in.has_trade", False, pending=True))
    assert decision["action"] == "confirm" and decision["asks"] == []


def test_held_questions_still_mean_no_asks():
    decision = _decide(hold_questions="possible opt-out")
    assert decision["asks"] == [] and "confirm" not in decision


def test_compose_gets_both_asks_and_the_offline_model_asks_both():
    decision = _decide()
    state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", decision=decision)
    payload = compose_payload(state)
    assert len(payload["asks"]) == 2
    draft = offline_compose(payload)
    assert draft["sms_text"].count("?") == 2
    assert "new or a used vehicle?" in draft["sms_text"]


def test_offline_model_confirmation_then_one_ask():
    decision = _decide(*SALES_ALL[:2], _fact("interest.budget", 30000, pending=True))
    state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", decision=decision)
    text = offline_compose(compose_payload(state))["sms_text"]
    assert text.count("?") == 2 and text.index("Just to confirm") < text.index("?")


def test_too_many_questions():
    assert too_many_questions({"sms_text": "A? B?", "email_body": "A? B?"}) == []
    assert too_many_questions({"sms_text": "A? B? C?", "email_body": "A?"}) == [
        "the SMS asks 3 questions (at most 2)"]


async def _guard(text):
    state = AgentState(dealer_id="d", customer_id="c", trigger="inbound_message", customer_text="hi",
                       draft={"sms_text": text, "email_subject": "Hi", "email_body": text})
    tracer = TurnTracer(sink=MemoryTraceSink(), dealer_id="d", lead_id=None, customer_id="c", trigger="t",
                        channel="sms", store_prompts=False)
    return (await guard(state, NodeSpan(), SimpleNamespace(tracer=tracer)))["guard_result"]


async def test_guard_sends_back_a_draft_with_three_questions():
    result = await _guard("Thanks! New or used? Which model? When are you buying?")
    assert not result["passed"] and not result["checks"]["at_most_two_questions"]
    assert result["next"] == "compose"
    assert "the SMS asks 3 questions (at most 2)" in result["violations"]


async def test_guard_passes_a_draft_with_two_questions():
    result = await _guard("Thanks! Are you looking for a new or a used vehicle? Which model do you have in mind?")
    assert result["checks"]["at_most_two_questions"] and result["passed"]
