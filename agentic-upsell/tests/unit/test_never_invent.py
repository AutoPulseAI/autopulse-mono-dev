"""Tests for the core anti-hallucination check (guardrails/never_invent.py).
This is the single most important piece of logic in the service — it runs
with no external dependencies (no LLM, no Mongo, no Redis), so there's no
excuse for it not being fully tested.
"""

from upsell_agent.agent.qualification import (
    AppointmentOffer,
    CapturedFact,
    FactSource,
)
from upsell_agent.agent.state import AgentState
from upsell_agent.guardrails.never_invent import check_appointment_offer


def _state_with_offer(value_proposition: str, facts: dict[str, CapturedFact] | None = None) -> AgentState:
    return AgentState(
        dealer_id="d1",
        customer_id="c1",
        trigger="inbound_message",
        captured_facts=facts or {},
        appointment_offer=AppointmentOffer(
            value_proposition=value_proposition,
            proposed_times=["10:30 tomorrow"],
        ),
    )


def test_no_offer_means_no_violations():
    state = AgentState(dealer_id="d1", customer_id="c1", trigger="inbound_message")
    assert check_appointment_offer(state) == []


def test_reflecting_back_a_customer_stated_number_is_allowed():
    """This is conversations.md's core successful pattern — restating the
    customer's own figures back to them, e.g. the Credit example's
    "your Altima ... approximately 82,000 miles and about a $9,000 payoff"."""
    facts = {
        "trade_mileage": CapturedFact(
            field_name="trade_mileage", value=82000, source=FactSource.CUSTOMER_STATED, captured_at_turn=1
        ),
        "trade_payoff_cents": CapturedFact(
            field_name="trade_payoff_cents", value="$9,000", source=FactSource.CUSTOMER_STATED, captured_at_turn=2
        ),
    }
    state = _state_with_offer(
        "Your Altima has about 82,000 miles and roughly a $9,000 payoff, so let's evaluate it together.",
        facts,
    )
    assert check_appointment_offer(state) == []


def test_inventing_a_trade_value_is_flagged():
    """The failure mode conversations.md exists to prevent: stating a number
    the customer never gave and no tool verified."""
    state = _state_with_offer("Your CR-V is worth about $14,500 based on the mileage you gave me.")
    violations = check_appointment_offer(state)
    assert len(violations) == 1
    assert "14,500" in violations[0]


def test_approval_language_is_flagged_even_without_a_number():
    state = _state_with_offer("Great news, you're approved for financing on the Camry!")
    violations = check_appointment_offer(state)
    assert any("Approval-implying language" in v for v in violations)


def test_guarantee_language_is_flagged():
    state = _state_with_offer("We can guarantee a payment under $550 for you.")
    violations = check_appointment_offer(state)
    # Both the guarantee language AND the invented $550 (not customer-stated
    # in this state) should be caught.
    assert any("Approval-implying language" in v for v in violations)
    assert any("550" in v for v in violations)


def test_customer_stated_target_payment_can_be_reflected_back():
    facts = {
        "target_payment_cents": CapturedFact(
            field_name="target_payment_cents",
            value="$550",
            source=FactSource.CUSTOMER_STATED,
            captured_at_turn=4,
        ),
    }
    state = _state_with_offer(
        "You mentioned wanting to stay under $550 a month, so let's structure the numbers around that target.",
        facts,
    )
    assert check_appointment_offer(state) == []


def test_tool_verified_fact_does_not_authorize_a_price_claim():
    """A TOOL_VERIFIED fact (e.g. real vehicle mileage on file) is NOT enough
    to authorize a PRICING/TRADE_VALUE/APPROVAL/AVAILABILITY claim per
    conversations.md's stricter rule for those categories - only
    CUSTOMER_STATED facts count for those. (SERVICE_NEED is the one category
    tool-verified facts DO ground, but that's not what's being asserted here.)
    """
    facts = {
        "trade_value_estimate": CapturedFact(
            field_name="trade_value_estimate",
            value="$14,500",
            source=FactSource.TOOL_VERIFIED,
            captured_at_turn=1,
        ),
    }
    state = _state_with_offer("Based on our system, your trade is worth $14,500.", facts)
    violations = check_appointment_offer(state)
    assert len(violations) == 1
    assert "14,500" in violations[0]
