"""Betsy, 13 Nov 2026 meeting (5.1): a customer who found or bought a car elsewhere ("I got a car, thank you") is its
own escalation - the lead goes to the dealer (Dealership Action Required), who closes it as lost."""

from upsell_agent.agent.escalation import manager_escalation
from upsell_agent.slots.policy import _not_interested_reason


def test_bought_elsewhere_has_its_own_reason():
    reason = _not_interested_reason("I got a car, thank you")
    assert reason.startswith("Customer found or bought a car elsewhere")
    assert "closes the lead as lost" in reason
    assert manager_escalation(reason) == "the customer bought elsewhere: the dealer closes the lead as lost"


def test_other_not_interested_reasons_are_unchanged():
    for said in ("can't afford it right now", None):
        reason = _not_interested_reason(said)
        assert reason.startswith("Customer says they're not interested any more")
        assert manager_escalation(reason) == "a person decides whether to close the lead"
