"""What staff record after a call reaches the AI (PLAN_4 stream H extra scope; the CRM's Call Tasks outcome
prompt, aidmvcs-be-dev/app/dealer/ai/components/CallOutcomeModal.js -> POST /v1/call-tasks/{id}/complete).

  specific_followup  -> the AI's dated next step, the same structure the AI builds for "call me Friday"
                        (Omnichannel PDF §6: date, time, channel, owner AI or human, context notes, entered by +
                        when), stage Contact Made - Specific Follow-Up. Owner AI: the check-back is scheduled
                        (scheduler/followups.plan_next_action); a "phone call" follow-up is checked back by text
                        and staff get the "please call" notice that day. Owner human: recorded, nothing scheduled.
  contact_no_action  -> stage Contact Made - No Next Action; the Short-Term cadence carries on (a touch is
                        planned when none is waiting).
  no_contact         -> nothing changes: the lead stays in its flow.
  wrong_number       -> the phone called is marked invalid (channels/suppression.py, as when a customer says
                        "wrong number") with the bad_contact notice; Opted Out / Suppressed when nothing is left.
  opted_out          -> the AI's own consent records: every channel (and stage Opted Out), or calls only when
                        staff pick "don't call" - not just the CRM's DND.
  appointment        -> the CRM's booking flow (unchanged, with its appointment type); nothing here.

A lead handed to staff (status handoff) goes back to the AI when the outcome gives the AI the next move
(an AI-owned follow-up, or the cadence carrying on). A lead staff paused stays paused.
"""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel

from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.channels import consent, suppression
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)

LeadOutcome = Literal["appointment", "specific_followup", "contact_no_action", "no_contact", "wrong_number",
                      "opted_out"]
SOURCE = "staff_call"


class FollowUp(BaseModel):
    date: str  # YYYY-MM-DD, dealer-local
    time: str | None = None  # HH:MM
    channel: Literal["sms", "email", "voice"] = "sms"
    owner: Literal["ai", "human"] = "ai"
    notes: str | None = None


def next_action_from(follow: FollowUp, *, by: str | None, default_time: str | None = None) -> dict[str, Any]:
    """The same fields decide.plan_next_action gives "call me Friday" (Omnichannel PDF §6), entered by staff.
    `default_time` (stream X2): the dealer's own default when staff gave no time."""
    from upsell_agent.agent.nodes.decide import NEXT_ACTION_DEFAULT_TIME

    day = date.fromisoformat(follow.date)
    call = follow.channel == "voice"
    notes = (follow.notes or "").strip()[:500]
    return {"date": day.isoformat(), "time": follow.time or default_time or NEXT_ACTION_DEFAULT_TIME, "time_given": bool(follow.time),
            "approximate": False, "words": f"{day.strftime('%A')}, {day.strftime('%B')} {day.day}",
            "display": f"{day.strftime('%A')}, {day.strftime('%B')} {day.day}",
            # A person phones; the AI's own check-back for a phone follow-up goes by text.
            "channel": "sms" if call else follow.channel, "call_requested": call, "owner": follow.owner,
            "entered_by": by or "staff", "entered_by_kind": "staff",
            "context_notes": f"Agreed on a call with staff: {notes}" if notes else "Agreed on a call with staff."}


async def _back_to_ai(db: DealerScopedDatabase, lead_id: str, why: str) -> bool:
    result = await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id, "status": "handoff"},
        {"$set": {"status": "active", "status_reason": why, "status_at": clock.now()}})
    return bool(result.modified_count)


async def apply(db: DealerScopedDatabase, task: dict[str, Any], outcome: LeadOutcome | None, *,
                follow_up: FollowUp | None = None, opt_out_scope: Literal["all", "voice"] = "all",
                by: str | None = None) -> dict[str, Any]:
    """Applies the lead outcome staff picked for a finished call task. Returns what happened (for the CRM)."""
    from upsell_agent.scheduler.followups import (
        KIND_CADENCE_TOUCH,
        plan_cadence_touch,
        plan_human_followup_check,
        plan_next_action,
    )

    lead_id, customer_id = task["lead_id"], task.get("customer_id")
    if not outcome or outcome in ("appointment", "no_contact"):
        return {"lead_outcome": outcome, "applied": False,
                "reason": "booked through the CRM's booking flow" if outcome == "appointment"
                else "no contact: the lead stays in its flow"}
    lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
    customer_id = customer_id or (str(lead["customer_id"]) if lead and lead.get("customer_id") else None)
    customer = await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one(
        {"_id": as_object_id(customer_id)}) if customer_id else None
    now = clock.now()
    who = by or "Staff"
    turn_id = f"call-outcome-{task['_id']}"
    out: dict[str, Any] = {"lead_outcome": outcome, "applied": True}

    if outcome == "specific_followup":
        if follow_up is None:
            return {"lead_outcome": outcome, "applied": False, "reason": "no follow-up date given"}
        from upsell_agent.integrations.dealer_profile import dealer_profile
        profile = await dealer_profile(db.dealer_id)
        planned = next_action_from(follow_up, by=by, default_time=profile.followup_default_time)
        out["stage_change"] = await lifecycle.apply(db, lead_id, [lifecycle.Event(
            "customer_replied", source=SOURCE, reason=f"{who} agreed a follow-up on {planned['display']} on a call",
            detail={"next_action": planned})], lead=lead, customer_id=customer_id)
        out["next_action"] = planned
        if follow_up.owner == "ai":
            out["back_to_ai"] = await _back_to_ai(db, lead_id, "Staff finished the call; the AI owns the next step")
            out["scheduled"] = await plan_next_action(
                db, lead_id=lead_id, customer_id=customer_id or "", channel=planned["channel"], turn_id=turn_id,
                next_action=planned, lead=lead, customer=customer)
        else:
            # Stream X2 (Omnichannel PDF §6 "No response 24h -> No Contact Made -> Short-Term"): the AI sends nothing
            # for a person's follow-up, but the 24-hour rule still applies - counted from the agreed time.
            out["scheduled"] = await plan_human_followup_check(db, lead_id=lead_id, customer_id=customer_id or "",
                                                               next_action=planned, tz=profile.tz)
        return out

    if outcome == "contact_no_action":
        out["stage_change"] = await lifecycle.apply(db, lead_id, [lifecycle.Event(
            "customer_replied", source=SOURCE, reason=f"{who} spoke with them on a call; no next step agreed")],
            lead=lead, customer_id=customer_id)
        out["back_to_ai"] = await _back_to_ai(db, lead_id, "Staff finished the call; the cadence carries on")
        waiting = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
            {"lead_id": lead_id, "kind": KIND_CADENCE_TOUCH, "status": "pending"})
        out["cadence_touch"] = {"created": False, "reason": "a cadence touch is already waiting"} if waiting else (
            await plan_cadence_touch(db, lead_id=lead_id, customer_id=customer_id or "", channel="sms",
                                     turn_id=turn_id, lead=lead, customer=customer, first_contact_done=True))
        return out

    if outcome == "wrong_number":
        phone = task.get("phone")
        out["suppressed"] = await suppression.suppress_contact(
            db, channel="sms", address=phone, reason=f"{who} called and it was the wrong number",
            source="staff_call_wrong_number", customer_id=customer_id, lead_id=lead_id,
            evidence={"call_task_id": str(task["_id"]), "by": by},
            notice=f"{phone} was marked invalid: {who} called and it was the wrong number. The AI won't text or "
                   "call it again.")
        return out

    # opted_out
    channels = ("voice",) if opt_out_scope == "voice" else consent_channels()
    for channel in channels:
        await consent.set_channel_consent(
            db, customer_id or "", channel, False, source="staff_call_opt_out", lead_id=lead_id,
            address=consent.resolve_recipient(lead, customer, "email" if channel == "email" else "sms"),
            evidence={"call_task_id": str(task["_id"]), "by": by, "scope": opt_out_scope})
    out["opted_out"] = list(channels)
    if opt_out_scope == "all":
        out["stage_change"] = await lifecycle.apply(db, lead_id, [lifecycle.Event(
            "opted_out", source=SOURCE, reason=f"{who}: the customer asked us to stop contacting them on a call")],
            lead=lead, customer_id=customer_id)
    else:
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {"staff_notice": {
            "at": now, "kind": "do_not_call",
            "text": f"{who}: the customer asked not to be called. Texts and emails carry on; no call tasks."}}})
    return out


def consent_channels() -> tuple[str, ...]:
    from upsell_agent.compliance.opt_out import ALL_CHANNELS

    return ALL_CHANNELS
