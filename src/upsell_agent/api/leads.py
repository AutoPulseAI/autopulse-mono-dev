"""GET /v1/leads/{lead_id}/profile — what the AI knows about a lead's
customer (architecture §11, MASTER_PLAN_1 Stage 7).

Called by the platform (shared-secret auth) for the dealer UI, and by the
Debug UI through /dev. Returns the fields FPLAN_1 "Fields you can rely on"
lists: lead status and reason, every slot with its state, source, source
message, capture time and earlier values, the missing required details,
progress, and the pending follow-up (Stage 10).
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from upsell_agent.api.auth import require_internal_auth
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.scheduler.followups import (
    CHANNEL_SWITCHES,
    KIND_HANDOFF_CHECK,
    KIND_RESUME,
    KIND_VISIT_FOLLOWUP,
)
from upsell_agent.slots.profile import build_profile
from upsell_agent.slots.requirements import lead_type_for
from upsell_agent.slots.store import current_facts, fact_history

router = APIRouter(prefix="/v1/leads", tags=["leads"], dependencies=[Depends(require_internal_auth)])


def _iso(value: Any) -> Any:
    if not isinstance(value, datetime):
        return value
    # Mongo hands back naive UTC datetimes.
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()


async def lead_profile(dealer_id: str, lead_id: str) -> dict[str, Any] | None:
    db = dealer_scoped_db(dealer_id)
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    if lead is None:
        return None
    customer_id = str(lead.get("customer_id") or "")
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
    profile = build_profile(
        lead_type_for(lead),
        await current_facts(db, customer_id, lead_id) if customer_id else [],
        await fact_history(db, customer_id, lead_id) if customer_id else [],
    )
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    pending = await followups.find(
        {"lead_id": lead_id, "status": "pending", **CHANNEL_SWITCHES}).sort("due_at", 1).to_list(1)
    check = await followups.find_one({"lead_id": lead_id, "status": "pending", "kind": KIND_HANDOFF_CHECK})
    morning = await followups.find_one({"lead_id": lead_id, "status": "pending", "kind": KIND_RESUME})
    visit_followup = await followups.find_one({"lead_id": lead_id, "status": "pending", "kind": KIND_VISIT_FOLLOWUP})
    alert = state.get("staff_alert")
    notice = state.get("staff_notice")
    visit = (state.get("conversation") or {}).get("visit")
    booking_id = (lead.get("data") or {}).get("bookingId")
    booking = await db.collection(PLATFORM_BOOKINGS_COLLECTION).find_one(
        {"_id": as_object_id(str(booking_id))}) if booking_id else None
    return {
        "lead": {"id": lead_id, "customer_id": customer_id, "status": state.get("status", "new"),
                 "status_reason": state.get("status_reason"), "lead_type": profile.lead_type.value},
        **profile.to_api(),
        "pending_followup": ({"channel": pending[0].get("to_channel"), "due_at": _iso(pending[0].get("due_at"))}
                             if pending else None),
        "pending_staff_check": {"due_at": _iso(check.get("due_at"))} if check else None,
        "staff_alert": {**alert, "at": _iso(alert.get("at"))} if alert else None,
        # MASTER_PLAN_3 B1: the after-hours morning message, and the team's notices (possible
        # opt-out, after-hours lead picked up). Kept on the AI's lead state; the platform doesn't show them yet.
        "pending_morning_message": {"due_at": _iso(morning.get("due_at"))} if morning else None,
        "staff_notice": {**notice, "at": _iso(notice.get("at"))} if notice else None,
        # MASTER_PLAN_3 B4/B5: the visit offer's state (attempts, angles used, times offered,
        # declined/stopped) and the dated fresh-offer follow-up after a 3rd decline.
        "visit": visit,
        "pending_visit_followup": {"due_at": _iso(visit_followup.get("due_at"))} if visit_followup else None,
        # The platform booking itself (MASTER_PLAN_3 B5), cancelled ones included.
        "booking": ({"id": str(booking["_id"]), "status": booking.get("booking_status"),
                     "date": _iso(booking.get("bookingDate")), "time": booking.get("bookingTime"),
                     "notes": booking.get("notes")} if booking else None),
    }


@router.get("/{lead_id}/profile")
async def get_profile(lead_id: str, dealer_id: str) -> dict[str, Any]:
    profile = await lead_profile(dealer_id, lead_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Lead not found for this dealer")
    return profile
