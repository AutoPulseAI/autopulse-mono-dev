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
    # Client, 12 Oct 2026 (Betsy): Dealership Action Required is assigned only when the customer replied AND the AI
    # couldn't set an appointment after trying more than once, the customer asks to speak with anyone at the
    # dealership, asks for something the AI can't supply (a video, custom photos), or seems angry.
    ("Customer is clearly upset", "an upset customer needs a manager"),
    ("Declined a visit more than once", "the AI tried to set an appointment more than once"),
    ("Customer asked for a person", "the customer asked to talk to a person"),
    ("Customer asked for a call", "the customer asked for a call"),
    ("Customer asked for a text from a person", "the customer asked for a person to text them"),
    ("Customer asked for something the AI can't supply", "the customer asked for something only staff can provide"),
    # Client, 1 Oct 2026 (scope answer 10): "not interested" with a reason - only a human can close-lost it.
    # (Not in Betsy's 12 Oct list; kept until she confirms - open question.)
    ("Customer says they're not interested any more", "a person decides whether to close the lead"),
)
# Not an escalation: "AI couldn't write a safe reply" (a soft handoff the AI takes back) - client, 12 Oct 2026 (Dylan
# Kirsch): a lead nobody has talked to stays in its follow-up, it isn't Dealership Action Required.


def manager_escalation(reason: str | None) -> str | None:
    """Why this handoff needs a manager, or None when it doesn't."""
    text = (reason or "").strip()
    return next((why for start, why in MANAGER_ESCALATIONS if text.startswith(start)), None)
