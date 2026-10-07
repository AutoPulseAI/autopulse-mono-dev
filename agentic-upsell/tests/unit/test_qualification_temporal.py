"""Tests for agent/qualification.py's Phase 0.3 extensions: the four-tier
FactSource, temporal-validity fields on CapturedFact, and the staleness rule
table (docs/architecture/architecture.md §8.1, §8.4).
"""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from upsell_agent.agent.qualification import (
    DEFAULT_STALENESS,
    CapturedFact,
    FactSource,
    staleness_rule_for,
    supersede,
)


def test_all_four_trust_tiers_exist():
    assert {FactSource.CUSTOMER_STATED, FactSource.TOOL_VERIFIED, FactSource.BOT_EXTRACTED, FactSource.BOT_INFERRED} == set(
        FactSource
    )


def test_customer_stated_fact_needs_no_source_message_id():
    fact = CapturedFact(
        field_name="trade_mileage", value=82000, source=FactSource.CUSTOMER_STATED, captured_at_turn=1
    )
    assert fact.source_message_id is None


def test_bot_extracted_fact_requires_source_message_id():
    with pytest.raises(ValidationError):
        CapturedFact(
            field_name="target_payment_cents",
            value=55000,
            source=FactSource.BOT_EXTRACTED,
            captured_at_turn=2,
        )


def test_bot_extracted_fact_with_source_message_id_is_valid():
    fact = CapturedFact(
        field_name="target_payment_cents",
        value=55000,
        source=FactSource.BOT_EXTRACTED,
        captured_at_turn=2,
        source_message_id="msg_42",
    )
    assert fact.source_message_id == "msg_42"


def test_new_fact_defaults_to_currently_valid():
    fact = CapturedFact(
        field_name="trade_mileage", value=82000, source=FactSource.CUSTOMER_STATED, captured_at_turn=1
    )
    assert fact.valid_to is None
    assert fact.replaced_by is None


def test_supersede_closes_out_the_old_fact_without_mutating_it():
    """The exact property the previous AI plan (git history) asks for: 'a new
    fact with the same field name closes out the old one's valid_to rather
    than leaving two current facts.'
    """
    old_fact = CapturedFact(
        field_name="trade_payoff_cents",
        value=900000,
        source=FactSource.CUSTOMER_STATED,
        captured_at_turn=3,
    )

    closed_out = supersede(old_fact, replaced_by_id="fact_turn7", at=datetime(2026, 1, 1, tzinfo=UTC))

    # The original object is untouched — CapturedFact is a point-in-time record.
    assert old_fact.valid_to is None
    assert old_fact.replaced_by is None
    # The returned copy is what actually gets written back as "no longer current".
    assert closed_out.valid_to == datetime(2026, 1, 1, tzinfo=UTC)
    assert closed_out.replaced_by == "fact_turn7"
    assert closed_out.value == 900000  # everything else about the old record is preserved


def test_staleness_rule_for_known_field():
    assert staleness_rule_for("trade_mileage") == timedelta(days=30)


def test_staleness_rule_for_unknown_field_falls_back_to_default():
    assert staleness_rule_for("some_new_field_nobody_has_configured_yet") == DEFAULT_STALENESS


def test_vehicle_availability_is_always_stale():
    """§8.1: availability-type facts are never trusted from memory at all —
    modeled here as a staleness window of zero, so any read is immediately
    past it and Phase 3's inventory tool always re-checks."""
    assert staleness_rule_for("vehicle_availability") == timedelta(0)
