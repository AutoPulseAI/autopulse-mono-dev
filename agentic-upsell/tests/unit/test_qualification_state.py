"""Structural tests for the qualification-conversation state (agent/state.py,
agent/qualification.py). These don't test agent behavior (nothing is
implemented yet) — they lock in the SHAPE of the state, especially the fact
that captured_facts merges/overwrites by field_name across turns rather than
accumulating duplicates, since that's the specific property conversations.md
requires ("remember and use the customer's responses") and is easy to get
wrong with a naive list-append reducer.
"""

from datetime import UTC, datetime

from upsell_agent.agent.qualification import CapturedFact, FactSource, LeadType
from upsell_agent.agent.state import AgentState, _merge_facts


def _base_state(**overrides) -> AgentState:
    defaults = dict(dealer_id="d1", customer_id="c1", trigger="inbound_message")
    defaults.update(overrides)
    return AgentState(**defaults)


def test_state_constructs_with_no_qualification_data_yet():
    state = _base_state()
    assert state.lead_type is None
    assert state.captured_facts == {}
    assert state.extraction is None
    assert state.decision is None
    assert state.draft is None
    assert state.retry_count == 0


def test_captured_facts_merge_overwrites_by_field_name_not_duplicates():
    """This is the exact property that makes CAPTURE cumulative instead of
    amnesiac across turns: a later value for the same field replaces the
    earlier one instead of both existing side by side.
    """
    turn3_fact = CapturedFact(
        field_name="trade_payoff_cents",
        value=900000,
        source=FactSource.CUSTOMER_STATED,
        captured_at_turn=3,
        raw_customer_text="I owe about $9,000",
    )
    turn7_correction = CapturedFact(
        field_name="trade_payoff_cents",
        value=850000,
        source=FactSource.CUSTOMER_STATED,
        captured_at_turn=7,
        raw_customer_text="actually I just checked, it's closer to $8,500",
    )

    merged = _merge_facts({"trade_payoff_cents": turn3_fact}, {"trade_payoff_cents": turn7_correction})

    assert len(merged) == 1
    assert merged["trade_payoff_cents"].value == 850000
    assert merged["trade_payoff_cents"].captured_at_turn == 7


def test_captured_facts_merge_is_additive_across_different_fields():
    mileage = CapturedFact(
        field_name="trade_mileage", value=82000, source=FactSource.CUSTOMER_STATED, captured_at_turn=1
    )
    payoff = CapturedFact(
        field_name="trade_payoff_cents", value=900000, source=FactSource.CUSTOMER_STATED, captured_at_turn=2
    )

    merged = _merge_facts({"trade_mileage": mileage}, {"trade_payoff_cents": payoff})

    assert set(merged.keys()) == {"trade_mileage", "trade_payoff_cents"}


def test_lead_types_match_architecture_8_2():
    assert {t.value for t in LeadType} == {"sales", "trade_in", "service", "general"}


def test_state_carries_a_conversation_turn():
    from upsell_agent.agent.qualification import ConversationTurn

    state = _base_state(
        conversation_history=[
            ConversationTurn(turn_index=1, speaker="customer", text="What's my CR-V worth?", timestamp=datetime.now(UTC))
        ]
    )
    assert len(state.conversation_history) == 1
    assert state.conversation_history[0].speaker == "customer"
