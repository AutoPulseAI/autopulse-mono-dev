"""Manager escalation (client, 8 Oct 2026): which AI handoffs put the lead into the CRM's Managerial Review."""

from upsell_agent.agent.escalation import MANAGERIAL_REVIEW, manager_escalation


def test_handoffs_that_need_a_manager():
    assert MANAGERIAL_REVIEW == "Managerial Review"
    # Client, 12 Oct 2026 (Betsy): only these.
    for reason in ("Customer is clearly upset (confidence 0.91)",
                   ("Customer says they're not interested any more: 'bought elsewhere' - a person decides whether "
                    "to close the lead"), "Declined a visit more than once", "Customer asked for a call",
                   "Customer asked for a text from a person", "Customer asked for something the AI can't supply: video"):
        assert manager_escalation(reason), reason


def test_handoffs_that_are_not_escalations():
    for reason in ("AI couldn't write a safe reply", "Customer sounds urgent (confidence 0.85)", "", None):
        assert manager_escalation(reason) is None, reason


def test_asking_for_a_person_is_dealership_action_required():
    # Client, 12 Oct 2026 (Betsy).
    for reason in ("Customer asked for a person - wants a call", "Customer asked for a person"):
        assert manager_escalation(reason), reason
