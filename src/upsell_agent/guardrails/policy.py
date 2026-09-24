"""Deterministic business/compliance rules — checked BEFORE calling the model
(see agent/nodes/recommend.py), because these are cheap, certain, and there's
no reason to pay for a model call on a customer we're not allowed to contact
right now.

is_item_suppressed is implemented for real against memory/long_term.py's
cooldown policy. is_contact_allowed remains a TODO — it depends on a decision
not yet made (see its docstring).
"""

from datetime import UTC, datetime

from upsell_agent.memory.models import CustomerUpsellProfile


def is_contact_allowed(dealer_id: str, customer_id: str) -> bool:
    """TODO, each backed by an existing concept elsewhere in the platform:
        - quiet_hours: reuse whatever TCPA local-time gate the n8n v8-phase1
          pipeline implements (see docs/architecture/architecture.md §6) — do
          not re-derive this logic independently; two different quiet-hours
          implementations drifting apart is a compliance risk, not just a bug.
        - dnd_check: respect Lead.fe_lead_status == 'DND' (see
          architecture.md §4.3) — an upsell recommendation must never be
          generated for a DND customer, full stop, before any model call.
          This needs a tool call (tools/customer_tool.py already fetches Lead
          data via the 360 endpoint) — deliberately not implemented here
          until that wiring exists, so this function isn't given a false
          sense of completeness by checking only one of its two real
          conditions.
    """
    raise NotImplementedError("is_contact_allowed: check DND status (via tools/customer_tool.py) + TCPA quiet hours")


def is_item_suppressed(profile: CustomerUpsellProfile | None, item_type: str) -> bool:
    """True if `item_type` is currently within its cooldown window per
    memory/long_term.py's REJECTION_THRESHOLD/COOLDOWN policy.
    `profile` is None for a customer with no upsell history yet — never
    suppressed in that case.
    """
    if profile is None:
        return False
    suppressed_until = profile.suppressed_item_types.get(item_type)
    if suppressed_until is None:
        return False
    return datetime.now(UTC) < suppressed_until
