"""Manager escalation: which AI handoffs put the lead into the CRM's "Managerial Review" (client, 8 Oct 2026).

There is one escalation flow, the CRM's: a lead set to Managerial Review gets the dealer's managerial review
follow-ups (Reminder Setting) and shows in the CRM's Managerial Review lists. Staff set it by hand; the AI sets it
when its own handoff needs a manager (this table), through POST /api/internal/ai/leads/status
(agent/crm_status.py), so both paths meet in the same place.

The table is the plug-in point for the client's if/then rules for manager escalation ("We need to provide
if...then... for manager escalation" - to be given on a call): add or change a row, nothing else moves.
Matched on the start of the handoff reason the AI records (slots/policy.py, agent/turn.py _handoff_reason).
"""

MANAGERIAL_REVIEW = "Managerial Review"

# (start of the handoff reason, why it needs a manager)
MANAGER_ESCALATIONS: tuple[tuple[str, str], ...] = (
    ("Customer is clearly upset", "an upset customer needs a manager"),
    ("Customer sounds urgent", "an urgent request needs a manager"),
    ("Customer says they're not interested any more", "a person decides whether to close the lead"),
    ("Declined a visit 3 times and a staff-only question is still open",
     "a staff-only question (price, approval, trade value) is still open"),
)
# Not escalations: "Customer asked for a person" (the call / text flow, agent/human_contact.py) and "AI couldn't write
# a safe reply" (a soft handoff the AI can take back).


def manager_escalation(reason: str | None) -> str | None:
    """Why this handoff needs a manager, or None when it doesn't."""
    text = (reason or "").strip()
    return next((why for start, why in MANAGER_ESCALATIONS if text.startswith(start)), None)
