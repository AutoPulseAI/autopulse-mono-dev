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

from upsell_agent import clock
from upsell_agent.agent import cadence, lead_bucket, lifecycle
from upsell_agent.api.auth import require_internal_auth
from upsell_agent.integrations.dealer_profile import dealer_profile
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
    KIND_CADENCE_TOUCH,
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
    call_timer = await followups.find_one({"lead_id": lead_id, "status": "pending", "kind": "call_task"})
    alert = state.get("staff_alert")
    notice = state.get("staff_notice")
    visit = (state.get("conversation") or {}).get("visit")
    booking_id = (lead.get("data") or {}).get("bookingId")
    booking = await db.collection(PLATFORM_BOOKINGS_COLLECTION).find_one(
        {"_id": as_object_id(str(booking_id))}) if booking_id else None
    next_action = state.get("next_action")
    # MASTER_PLAN_3 C4: where the lead is in the Day 1-90 cadence, and the touch that's due next.
    cadence_state = cadence.CadenceState.load(state)
    profile_row = await dealer_profile(dealer_id)
    touch_row = await followups.find_one({"lead_id": lead_id, "status": "pending", "kind": KIND_CADENCE_TOUCH})
    cadence_view = ({**cadence.describe(cadence_state, clock.now(), profile_row.tz),
                     "next_touch": ({**(touch_row.get("touch") or {}), "due_at": _iso(touch_row.get("due_at"))}
                                    if touch_row else None)}
                    if cadence_state.started_at else None)
    # MASTER_PLAN_4 D2/D3 (stream A3): the opportunity status, SOLD PENDING's cadence and the ownership lifecycle.
    from upsell_agent.scheduler.sold_lifecycles import lead_view
    sold = await lead_view(db, lead_id, {**state, "customer_id": state.get("customer_id") or customer_id})
    return {
        **sold,
        "lead": {"id": lead_id, "customer_id": customer_id, "status": state.get("status", "new"),
                 "status_reason": state.get("status_reason"), "lead_type": profile.lead_type.value,
                 # MASTER_PLAN_4 A1: the sales bucket (blueprint §2) and the one it started in, for reporting.
                 "bucket": state.get("bucket"), "original_bucket": state.get("original_bucket")},
        "bucket": lead_bucket.for_api(state),
        # MASTER_PLAN_4 F2: service visits passed to the team as requests (never booked in this SOW).
        "service_requests": [{**r, "noticed_at": _iso(r.get("noticed_at"))} for r in state.get("service_requests") or []],
        # MASTER_PLAN_3 C3: where the lead stands in the client's workflow (agent/lifecycle.py), its
        # opportunity clock (never reset), a dated next step, and how it got here.
        "cadence": cadence_view,
        "lifecycle": {
            "stage": state.get("stage"), "label": lifecycle.label(state.get("stage")),
            "reason": state.get("stage_reason"), "since": _iso(state.get("stage_at")),
            "opportunity_created_at": _iso(state.get("opportunity_created_at")),
            "opportunity_age_days": lifecycle.opportunity_age_days(state),
            "opportunity_closed_at": _iso(state.get("opportunity_closed_at")),
            "next_action": ({**next_action, "entered_at": _iso(next_action.get("entered_at"))}
                            if next_action else None),
            "appointment": ({**state["appointment"], "planned_at": _iso(state["appointment"].get("planned_at")),
                             "confirmed_at": _iso(state["appointment"].get("confirmed_at")),
                             "showed_at": _iso(state["appointment"].get("showed_at"))}
                            if state.get("appointment") else None),
            "history": [{**h, "at": _iso(h.get("at"))} for h in state.get("stage_history") or []],
        },
        **profile.to_api(),
        "pending_followup": ({"channel": pending[0].get("to_channel"), "due_at": _iso(pending[0].get("due_at"))}
                             if pending else None),
        "pending_staff_check": {"due_at": _iso(check.get("due_at"))} if check else None,
        "staff_alert": {**alert, "at": _iso(alert.get("at"))} if alert else None,
        # MASTER_PLAN_3 B1: the after-hours morning message, and the team's notices (possible
        # opt-out, after-hours lead picked up). Kept on the AI's lead state; the platform doesn't show them yet.
        "pending_morning_message": {"due_at": _iso(morning.get("due_at"))} if morning else None,
        "staff_notice": {**notice, "at": _iso(notice.get("at"))} if notice else None,
        # MASTER_PLAN_3 C2: the staff call task - waiting behind its 60-minute timer, or open for staff.
        "call_task": ({**state["call_task"], "opened_at": _iso(state["call_task"].get("opened_at"))}
                      if state.get("call_task") else None),
        "pending_call_timer": {"due_at": _iso(call_timer.get("due_at"))} if call_timer else None,
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
