"""Long-term memory: durable, cross-conversation facts about a customer's
upsell relationship, stored in THIS service's own MongoDB collections, in the
SAME database aidmvcs-be-dev uses — see integrations/mongodb.py and
../../INTEGRATION.md.

This is explicit, queryable, and auditable — a support/compliance question
like "why did we offer this customer a warranty three times in two months" is
answered by reading `customer_upsell_profile`, not by re-running the model and
hoping it explains itself the same way twice.

Two collections, two different lifetimes (see ../../README.md's short/long
term split):
  - `customer_upsell_profile` — one doc per (dealer_id, customer_id), lives
    across every conversation/lead this customer ever has. This is genuinely
    long-term: a decision made in January must still suppress a re-offer in
    June.
  - `qualification_conversation_log` — an append-only audit snapshot of a
    completed/checkpointed qualification conversation (see
    persist_conversation_snapshot). NOT the live working state — that's
    memory/short_term.py's job, in Redis, via LangGraph's checkpointer. This
    is the durable copy taken once a conversation reaches a terminal point,
    since Redis is not meant as permanent storage and a checkpoint can be
    evicted.
"""

from datetime import UTC, datetime, timedelta

from upsell_agent.agent.state import AgentState
from upsell_agent.integrations.mongodb import get_db
from upsell_agent.memory.models import CustomerUpsellProfile, UpsellDecision

PROFILE_COLLECTION = "customer_upsell_profile"
CONVERSATION_LOG_COLLECTION = "qualification_conversation_log"

# Policy default: an item_type declined this many times gets suppressed for
# the cooldown window below. This is a product decision, not an engineering
# one (see guardrails/policy.py's matching TODO) — hardcoded here as an
# explicit, documented default so it's easy to find and change, not because
# it's been signed off on.
REJECTION_THRESHOLD = 2
COOLDOWN = timedelta(days=30)


def _profile_key(dealer_id: str, customer_id: str) -> dict:
    return {"dealer_id": dealer_id, "customer_id": customer_id}


async def get_profile(dealer_id: str, customer_id: str) -> CustomerUpsellProfile | None:
    doc = await get_db()[PROFILE_COLLECTION].find_one(_profile_key(dealer_id, customer_id))
    if doc is None:
        return None
    doc.pop("_id", None)
    return CustomerUpsellProfile.model_validate(doc)


async def _get_or_create_profile(dealer_id: str, customer_id: str) -> CustomerUpsellProfile:
    existing = await get_profile(dealer_id, customer_id)
    if existing is not None:
        return existing
    return CustomerUpsellProfile(
        dealer_id=dealer_id,
        customer_id=customer_id,
        decisions=[],
        suppressed_item_types={},
        updated_at=datetime.now(UTC),
    )


async def record_feedback(
    dealer_id: str,
    customer_id: str,
    source_id: str,
    item_type: str,
    decision: str,
    trigger: str,
    staff_note: str | None = None,
) -> CustomerUpsellProfile:
    """Persist a staff decision on a recommendation and apply the cooldown
    policy if this pushes an item_type over REJECTION_THRESHOLD. Returns the
    updated profile so the caller (api/routes.py's /upsell/feedback) can
    confirm what changed without a second read.
    """
    profile = await _get_or_create_profile(dealer_id, customer_id)

    profile.decisions.append(
        UpsellDecision(
            item_type=item_type,
            source_id=source_id,
            recommended_at=datetime.now(UTC),
            decision=decision,
            decided_at=datetime.now(UTC),
            staff_note=staff_note,
            trigger=trigger,
        )
    )

    if decision == "rejected":
        recent_rejections = sum(
            1
            for d in profile.decisions
            if d.item_type == item_type
            and d.decision == "rejected"
            and d.decided_at is not None
            and d.decided_at >= datetime.now(UTC) - COOLDOWN
        )
        if recent_rejections >= REJECTION_THRESHOLD:
            profile.suppressed_item_types[item_type] = datetime.now(UTC) + COOLDOWN

    profile.updated_at = datetime.now(UTC)

    await get_db()[PROFILE_COLLECTION].update_one(
        _profile_key(dealer_id, customer_id),
        {"$set": profile.model_dump()},
        upsert=True,
    )
    return profile


async def persist_conversation_snapshot(state: AgentState, reason: str) -> None:
    """Append-only durable copy of a qualification conversation's state at a
    terminal point (appointment booked, conversation abandoned, etc.).
    `reason` documents WHY this snapshot was taken (e.g. 'appointment_confirmed',
    'lead_marked_dnd', 'objection_limit_reached') — see agent/graph.py for
    where this gets called from once the graph is fully wired.
    """
    doc = {
        "dealer_id": state.dealer_id,
        "customer_id": state.customer_id,
        "lead_id": state.lead_id,
        "lead_type": state.lead_type.value if state.lead_type else None,
        "captured_facts": {k: v.model_dump() for k, v in state.captured_facts.items()},
        "appointment_offer": state.appointment_offer.model_dump() if state.appointment_offer else None,
        "conversation_turns": len(state.conversation_history),
        "snapshot_reason": reason,
        "snapshotted_at": datetime.now(UTC),
    }
    await get_db()[CONVERSATION_LOG_COLLECTION].insert_one(doc)
