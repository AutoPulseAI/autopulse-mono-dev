"""Manager escalation (client, 8 Oct 2026): which AI handoffs put the lead into the CRM's Managerial Review."""

from upsell_agent.agent.escalation import MANAGERIAL_REVIEW, manager_escalation


def test_handoffs_that_need_a_manager():
    assert MANAGERIAL_REVIEW == "Managerial Review"
    for reason in ("Customer is clearly upset (confidence 0.91)", "Customer sounds urgent (confidence 0.85)",
                   "Customer says they're not interested any more: 'bought elsewhere' - a person decides whether to "
                   "close the lead", "Declined a visit 3 times and a staff-only question is still open"):
        assert manager_escalation(reason), reason


def test_handoffs_that_are_not_escalations():
    for reason in ("Customer asked for a person - wants a call", "Customer asked for a person",
                   "AI couldn't write a safe reply", "", None):
        assert manager_escalation(reason) is None, reason
