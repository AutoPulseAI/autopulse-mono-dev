"""What the worker does for each event (architecture §4-§5, §11).

Kept free of SAQ so tests call these directly. worker/jobs.py is a thin
wrapper that adds the lead lock / dealer cap and passes the payload through.

Never silent (MASTER_PLAN_2 Phase 2): every customer message ends up either
answered by a turn or with a recorded reason. When the AI doesn't answer (the
lead is with staff or paused, or the message was STOP / START / an opt-out), a
short "held" turn is logged (trigger `inbound_held`) saying why. On a
handed-off lead the customer gets a holding reply, at most one every
HOLDING_REPLY_EVERY (architecture §15, decision 12).
"""

import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import ai_studio, clock
from upsell_agent.agent import after_handoff, auto_reply, duplicates, human_contact, lifecycle
from upsell_agent.agent.customer_key import find_customer_leads, lead_customer_id
from upsell_agent.agent.portal_text import clean_comments
from upsell_agent.agent.templates import known_first_name, render_holding_reply
from upsell_agent.agent.turn import (
    TurnDeps,
    find_customer,
    find_lead,
    lead_type_from_lead,
    run_turn,
)
from upsell_agent.channels import consent, suppression
from upsell_agent.channels.sender import SendRequest
from upsell_agent.compliance import text_consent
from upsell_agent.compliance import opt_out as opt_out_rules
from upsell_agent.compliance.opt_out import OptIn, confirmation_text, detect_opt_in, detect_opt_out
from upsell_agent.config import get_settings
from upsell_agent.events.models import (
    BookingChangedEvent,
    InboundMessageEvent,
    LeadCreatedEvent,
    LeadPausedEvent,
    LeadResumedEvent,
)
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.learning import touches
from upsell_agent.observability.trace import TurnTracer
from upsell_agent.scheduler import studio_cadences
from upsell_agent.scheduler.followups import (
    CHANNEL_SWITCHES,
    SOLD_LIFECYCLE_KINDS,
    STAFF_REPLY_REASON,
    appointment_cancelled_on_platform,
    cancel_call_task,
    plan_appointment_timers,
    plan_cadence_touch,
    plan_staff_quiet,
    replan_workflow,
    staff_no_show,
)

from upsell_agent.agent.turn import NEW_INQUIRY_PREFIX  # noqa: E402

logger = logging.getLogger(__name__)

# Statuses in which the AI doesn't write replies (architecture §5 step 3). An opt-out is no longer
# one of them: it stops what we start, never the reply to the customer's own message (decision 137).
SILENT_STATUSES = {"handoff", "paused"}
# What the AI does with a customer's Y / N to the day-before confirmation (MASTER_PLAN_3 C5, Omnichannel PDF §8).
APPOINTMENT_ACTIONS = ("appointment_confirmed", "appointment_clarify", "appointment_reschedule")
HOLDING_REPLY_EVERY = timedelta(hours=2)


async def _cancel_pending_followups(db: DealerScopedDatabase, lead_id: str, *, channel_switches_only: bool) -> int:
    """A customer message cancels the channel switch (they replied) but not
    the handoff check (staff still haven't). Staff pausing the lead cancels both."""
    flt: dict[str, Any] = {"lead_id": lead_id, "status": {"$in": ["pending", "standby"]}}
    if channel_switches_only:
        flt.update(CHANNEL_SWITCHES)
    else:
        # MASTER_PLAN_4 (stream A3): staff taking a lead over doesn't end SOLD PENDING or an ownership lifecycle -
        # only an outcome or the stage does (scheduler/sold_lifecycles.py re-checks them when they fire).
        # PLAN_4 stream T: nor the Days 1-7 human call tasks - they are for staff anyway; cancel_call_task ends this
        # half-day's one and the stage decides the rest.
        # A cadence added in AI Studio checks the lead's status itself when it fires (it may be the status change
        # that started it).
        flt["kind"] = {"$nin": [*SOLD_LIFECYCLE_KINDS, "daily_call_task", "studio_touch"]}
    result = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
        flt, {"$set": {"status": "cancelled", "cancelled_at": clock.now()}})
    return result.modified_count


async def _ensure_lead_state(db: DealerScopedDatabase, lead_id: str, customer_id: str, lead: dict | None) -> dict:
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": customer_id, "status": "active",
                          "status_reason": None, "lead_type": lead_type_from_lead(lead).value,
                          "created_at": clock.now()}},
        upsert=True,
    )
    return await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id})


async def _set_status(db: DealerScopedDatabase, lead_id: str, status: str, reason: str | None) -> None:
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"status": status, "status_reason": reason, "status_at": clock.now()}}
    )


def _comments(lead: dict | None) -> str:
    if not lead:
        return ""
    data = lead.get("data") or {}
    return clean_comments(data.get("comments") or lead.get("comments") or "")


def _parse_received_at(value: str | datetime | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def batch_entry(row: dict) -> dict[str, Any]:
    """One stored customer message as the turn's trace and context pack list it."""
    at = row.get("created_at")
    return {"id": str(row["_id"]), "channel": row.get("channel"), "text": row.get("text"),
            "at": at.isoformat() if isinstance(at, datetime) else at}


def first_reply_turn_id(lead_id: str) -> str:
    return f"lead-created-{lead_id}"


def reply_turn_id(message_row_id: Any) -> str:
    return f"inbound-{message_row_id}"


async def _already_sent(db: DealerScopedDatabase, turn_id: str) -> dict | None:
    """A send for this exact turn already exists: this job is a re-run
    (a retry after a late error, or the queue delivering it twice)."""
    return await db.collection(AI_MESSAGES_COLLECTION).find_one({"turn_id": turn_id, "direction": "outbound"})


# The old (20 Oct) ownership-alerts question; Betsy's 22 Oct wording replaced it (compliance/opt_out.py). Leads asked
# it before still have their answer read (alerts_question_at).
_ALERTS_YES = re.compile(r"^\W*(?:y|yes|yeah|yep|yup|sure|ok|okay|please|yes please)\W*$", re.IGNORECASE)


async def _owns_vehicle(db: DealerScopedDatabase, customer_id: str | None) -> bool:
    """The customer has a vehicle from us: a Sold - Delivered lead, or the owner life cycle running for them."""
    if not customer_id:
        return False
    if await db.collection(AI_LEAD_STATE_COLLECTION).find_one(
            {"customer_id": customer_id, "stage": lifecycle.Stage.SOLD_DELIVERED.value}, projection={"_id": 1}):
        return True
    if await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
            {"customer_id": customer_id, "kind": "owner_touch"}, projection={"_id": 1}):
        return True
    # Betsy, 22 Oct 2026 ("your current vehicle(s) on file"): a vehicle they bought from us in DealerVault counts too.
    from upsell_agent.integrations.mongodb import PLATFORM_DEALS_COLLECTION, as_object_id
    ids = [customer_id] + ([oid] if (oid := as_object_id(customer_id)) is not None else [])
    return bool(await db.collection(PLATFORM_DEALS_COLLECTION).find_one(
        {"customer_id": {"$in": ids}, "vin": {"$nin": [None, ""]}}, projection={"_id": 1}))


async def _opt_back_in_from_lead(db: DealerScopedDatabase, event: LeadCreatedEvent, lead: dict | None) -> None:
    """Betsy, 22 Oct 2026: "the customer sending any text, even just 'hi', and/or submitting a lead, opts the customer
    back in". A new lead from them reverses their text and email opt-outs (a "don't call me" stays, and an address
    the email provider itself reports unsubscribed stays: it keeps refusing it - decision 143). Every other check
    still applies to the new lead (a form that says no to texts, texting hours, DND)."""
    if not event.customer_id:
        return
    # Live, 23 Oct 2026: a portal's "this person is still active" alert (Cars.com Shopper Alert) is not the customer
    # submitting anything - only a lead they sent opts them back in.
    said = " ".join(str(x or "") for x in ((lead or {}).get("source"), (lead or {}).get("lead_source"),
                                            (lead or {}).get("comments"), ((lead or {}).get("data") or {}).get("comments")))
    if re.search(r"shopper\s*alert|still\s*active|price\s*drop\s*alert|saved\s*search", said, re.IGNORECASE):
        return
    for channel in ("sms", "email"):
        address = (lead or {}).get("phone" if channel == "sms" else "email")
        last = await consent.latest_opt_out(db, event.customer_id, channel, address)
        if not last or last.get("consent_status") != "opted_out":
            continue
        if channel == "email" and str(last.get("consent_source") or "").startswith("sendgrid_"):
            continue
        await consent.record_consent(db, customer_id=event.customer_id, channel=channel, consent_type="opt_out",
                                     status="opted_in", source="customer_new_lead", lead_id=event.lead_id,
                                     evidence={"lead_id": event.lead_id, "source": (lead or {}).get("source")},
                                     address=consent.address_key(channel, address))


async def handle_lead_created(event: LeadCreatedEvent, deps: TurnDeps,
                              received_at: str | datetime | None = None) -> dict[str, Any]:
    await ai_studio.refresh()  # the settings published in AI Studio (upsell_agent/ai_studio.py)
    db = dealer_scoped_db(event.dealer_id)
    await studio_cadences.start(db, lead_id=event.lead_id, customer_id=event.customer_id, channel=event.channel,
                                trigger={"type": "lead_created"})  # cadences added in AI Studio
    lead = await find_lead(db, event.lead_id)
    if not event.shadow:
        await _opt_back_in_from_lead(db, event, lead)
    state = await _ensure_lead_state(db, event.lead_id, event.customer_id, lead)
    if not state.get("duplicate_of") and (primary := await duplicates.find_primary(db, lead)):
        # MASTER_PLAN_3 C6: the same customer already has an open lead the AI is working. This one is
        # linked to it; no first reply, no cadence, no second workflow.
        linked = await duplicates.link_duplicate(db, event.lead_id, event.customer_id, primary)
        restarted = await _restart_opportunity_clock(db, event, primary["lead_id"])
        # Client, 12 Oct 2026: a second lead within 30 days gets "Hello again ... comparing models, or more than one
        # vehicle?" (agent/multi_vehicle.py); after that, the new inquiry is answered as usual.
        answered = await _ask_multi_vehicle(db, deps, event, lead, primary["lead_id"])
        if answered.get("status") != "done":
            answered = await _answer_new_inquiry_on_primary(db, deps, event, lead, primary["lead_id"], received_at)
        if restarted.get("cadence_started") and answered.get("status") == "done":
            restarted["cadence_touch"] = await plan_cadence_touch(
                db, lead_id=primary["lead_id"], customer_id=event.customer_id, channel=event.channel,
                turn_id=f"reengaged-{event.lead_id}", lead=await find_lead(db, primary["lead_id"]),
                first_contact_done=True)
        return {"status": "duplicate", "reason": f"same customer as open lead {primary['lead_id']}", **linked,
                "new_inquiry": answered, "reengaged": restarted}
    if state.get("duplicate_of"):
        return {"status": "duplicate", "reason": f"linked to lead {state['duplicate_of']}",
                "duplicate_of": state["duplicate_of"]}
    if not event.shadow:
        # MASTER_PLAN_3 C3: the lead's stage and its opportunity clock start here.
        await lifecycle.apply(db, event.lead_id, [lifecycle.Event("lead_created", source="lead_created")],
                              lead=lead, customer_id=event.customer_id)
    if state["status"] in SILENT_STATUSES:
        return {"status": "skipped", "reason": f"lead is {state['status']}"}
    turn_id = first_reply_turn_id(event.lead_id)
    if (previous := await _already_sent(db, turn_id)) and previous.get("status") != "held":
        return {"status": "already_answered", "turn_id": turn_id, "send_status": previous.get("status")}
    return await _first_reply(db, deps, customer_id=event.customer_id, lead_id=event.lead_id, lead=lead,
                              channel=event.channel, shadow=event.shadow,
                              received_at=_parse_received_at(received_at), turn_id=turn_id)


MULTI_VEHICLE_WAIT = timedelta(hours=24)


def _lead_car(lead: dict | None) -> tuple[str, str] | None:
    """(VIN, "year make model") of the car a lead is about, or None when it names none."""
    lead = lead or {}
    data = lead.get("data") or {}
    vehicle = lead.get("vehicle") or data.get("vehicle") or {}
    vehicle = vehicle if isinstance(vehicle, dict) else {}
    vin = str(lead.get("vin") or data.get("vin") or vehicle.get("vin") or "").strip().upper()
    named = " ".join(str(vehicle.get(k) or lead.get(k) or "").strip() for k in ("year", "make", "model")).strip().lower()
    return (vin, named) if vin or named else None


async def _ask_multi_vehicle(db: DealerScopedDatabase, deps: TurnDeps, event: LeadCreatedEvent, lead: dict | None,
                             primary_id: str) -> dict[str, Any]:
    """agent/multi_vehicle.py: the "Hello again" question on the customer's conversation, when their open lead is
    under 30 days old. Fixed wording, text and email, once per new lead; not while staff own the conversation."""
    from upsell_agent.agent import multi_vehicle
    from upsell_agent.scheduler.sold_lifecycles import _send_both

    if event.shadow:
        return {"status": "skipped", "reason": "shadow"}
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    primary_state = await states.find_one({"lead_id": primary_id}) or {}
    if primary_state.get("status") in SILENT_STATUSES:
        return {"status": "skipped", "reason": "staff own the conversation"}
    started = lifecycle._aware(primary_state.get("opportunity_created_at"))
    if not multi_vehicle.within_window(started, clock.now()):
        return {"status": "skipped", "reason": "the open lead is older than 30 days"}
    # Christine Pache, 26 Oct 2026: a CarGurus phone-call lead with no car on it got "thank you for inquiring about
    # another vehicle". Only a different car is another vehicle; no car, or the same car, carries on as it is.
    new_car, open_car = _lead_car(lead), _lead_car(await find_lead(db, primary_id))
    same_vin = bool(new_car and open_car and new_car[0] and new_car[0] == open_car[0])
    if not new_car or same_vin or (new_car == open_car and not new_car[0]):
        return {"status": "done", "reason": "no other vehicle named: the same inquiry, nothing to ask"}
    turn_id = f"multi-vehicle-{event.lead_id}"
    if await _already_sent(db, turn_id):
        return {"status": "already_answered", "turn_id": turn_id}
    # Yefri Montoya, 28 Oct 2026: three CarGurus inquiries in 10 minutes (Venue, Equinox, Rogue) got three emails in 10
    # minutes, the "are you comparing models?" question twice. One question at a time: while one is unanswered (24 h),
    # a further inquiry sends nothing - staff get a note with the car, and the AI's next message has it.
    now = clock.now()
    asked = primary_state.get("multi_vehicle_question") or {}
    asked_at, last_in = lifecycle._aware(asked.get("asked_at")), lifecycle._aware(primary_state.get("last_inbound_at"))
    unanswered = bool(asked_at and not asked.get("answered") and now - asked_at < MULTI_VEHICLE_WAIT
                      and not (last_in and last_in > asked_at))
    if unanswered:
        from upsell_agent.agent import crm_notes
        car = multi_vehicle.vehicle_label(lead) or "another vehicle"
        await crm_notes.write(db, lead_id=primary_id, kind="another_inquiry", customer_id=event.customer_id,
                              key=f"another_inquiry:{event.lead_id}", platform=deps.platform,
                              text=f"The customer also inquired about the {car} (lead {event.lead_id}). No new message was "
                                   "sent: they haven't answered our question about the other car yet.")
        return {"status": "done", "reason": "a question is already waiting for their reply: noted, nothing sent"}
    text = multi_vehicle.question_text(known_first_name((lead or {}).get("name")),
                                       multi_vehicle.vehicle_label(lead))
    tracer = TurnTracer(sink=deps.sink, dealer_id=db.dealer_id, lead_id=primary_id, customer_id=event.customer_id,
                        trigger="multi_vehicle_question", channel=event.channel, store_prompts=deps.store_prompts,
                        turn_id=turn_id)
    await tracer.start({"new_lead_id": event.lead_id, "text": text["sms_text"]})
    doc = {"_id": event.lead_id, "kind": "multi_vehicle", "lead_id": primary_id, "customer_id": event.customer_id,
           "to_channel": "sms" if event.channel == "sms" else "email"}
    outcomes = await _send_both(db, deps, tracer, doc, text, "lead_response")
    sent = any(o.status in ("sent", "duplicate") for o in outcomes)
    if sent:
        # Deyvi Lopez, 28 Oct 2026: the question was held for the night and never sent, yet recorded as asked - his
        # next inquiry in the morning was then held back "waiting for his answer". Only a question that went counts.
        await states.update_one({"lead_id": primary_id}, {"$set": {"multi_vehicle_question": {
            "new_lead_id": event.lead_id, "asked_at": clock.now(), "answered": None}}})
    log = await tracer.finish("multi_vehicle_question" if sent else "multi_vehicle_question_not_sent",
                              {"sent": [{"channel": o.channel, "status": o.status} for o in outcomes]})
    await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
    return {"status": "done" if sent else "not_sent", "turn_id": turn_id}


async def _resolve_multi_vehicle(db: DealerScopedDatabase, event: InboundMessageEvent, lead_id: str, state: dict,
                                 text: str, lead: dict | None) -> dict[str, Any] | None:
    """The customer's answer to the "Hello again" question (agent/multi_vehicle.py)."""
    from upsell_agent.agent import multi_vehicle
    question = multi_vehicle.open_question(state, clock.now())
    if not question or event.shadow:
        return None
    answer = multi_vehicle.classify(text)
    if answer is None:
        return None
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    new_lead_id = question["new_lead_id"]
    await states.update_one({"lead_id": lead_id}, {"$set": {"multi_vehicle_question.answered": answer,
                                                             "multi_vehicle_question.answered_at": clock.now()}})
    if answer == "one":
        # The original lead closes as Closed - Lost; finishing it releases the new lead as the working lead.
        change = await lifecycle.apply(db, lead_id, [lifecycle.Event(
            "one_vehicle", source="customer_answer", reason=f"The customer is shopping for one vehicle: {text[:120]!r}")],
            lead=lead, customer_id=event.customer_id)
        return {"answer": "one", "closed": lead_id, "stage_change": change}
    # Both: the new lead runs its own workflow too.
    now = clock.now()
    new_lead = await find_lead(db, new_lead_id)
    await states.update_one({"lead_id": new_lead_id}, {
        "$set": {"status": "active", "status_reason": None, "status_at": now, "duplicate_released_at": now,
                 "released_from": lead_id},
        "$unset": {"duplicate_of": ""}})
    await lifecycle.apply(db, new_lead_id, [lifecycle.Event(
        "lead_created", source="multi_vehicle_both", reason="The customer is interested in both vehicles")],
        lead=new_lead, customer_id=event.customer_id)
    await plan_cadence_touch(db, lead_id=new_lead_id, customer_id=event.customer_id,
                             channel=((new_lead or {}).get("data") or {}).get("channel") or "sms",
                             turn_id=f"multi-vehicle-both-{new_lead_id}", lead=new_lead, first_contact_done=True)
    return {"answer": "both", "kept_open": [lead_id, new_lead_id]}


async def _restart_opportunity_clock(db: DealerScopedDatabase, event: LeadCreatedEvent,
                                     primary_id: str) -> dict[str, Any]:
    """Client, 10 Oct 2026 (Betsy): "legally when a customer re-engages, sends a new lead, the 90 day clock starts
    over". The customer's new inquiry is a new own-inquiry: the Day 91 period counts from today (`day91_anchor`),
    the own-inquiry texting window counts from today (`last_inquiry_at`, compliance/engine.py), and a working lead
    starts a fresh cadence (lifecycle "reengaged"). Never in shadow."""
    if event.shadow:
        return {"status": "skipped", "reason": "shadow"}
    now = clock.now()
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": primary_id}, {"$set": {"day91_anchor": now, "last_inquiry_at": now,
                                           "reengaged_at": now, "reengaged_by_lead": event.lead_id}})
    primary_lead = await find_lead(db, primary_id)
    change = await lifecycle.apply(db, primary_id, [lifecycle.Event(
        "reengaged", source="new_inquiry", reason=f"The customer sent a new inquiry (lead {event.lead_id})")],
        lead=primary_lead, customer_id=event.customer_id)
    return {"status": "restarted", "day91_anchor": now.isoformat(),
            "cadence_started": bool((change or {}).get("cadence_started"))}


async def _answer_new_inquiry_on_primary(db: DealerScopedDatabase, deps: TurnDeps, event: LeadCreatedEvent,
                                        lead: dict | None, primary_id: str,
                                        received_at: str | datetime | None) -> dict[str, Any]:
    """Client, 10 Oct 2026: a customer who already has an open lead and sends a new inquiry (another vehicle, another
    portal) gets an answer to it - in the existing conversation, so still one workflow, one thread (C6). Before, the
    new lead was linked and nothing was said: from the customer's side the inquiry went unanswered. Not while staff
    own the primary (they have the notice), never twice for the same lead, nothing in shadow."""
    if event.shadow:
        return {"status": "skipped", "reason": "shadow"}
    primary_state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": primary_id}) or {}
    if primary_state.get("status") in SILENT_STATUSES:
        return {"status": "skipped", "reason": f"the primary lead is {primary_state.get('status')} (staff have it)"}
    turn_id = f"new-inquiry-{event.lead_id}"
    if await _already_sent(db, turn_id):
        return {"status": "already_answered", "turn_id": turn_id}
    text = _comments(lead)
    if not text.strip():
        return {"status": "skipped", "reason": "the new lead carries no inquiry text"}
    log = await run_turn(
        dealer_id=db.dealer_id, customer_id=primary_state.get("customer_id") or event.customer_id,
        lead_id=primary_id, trigger="inbound_message", channel=event.channel,
        inbound_text=f"{NEW_INQUIRY_PREFIX} {text}", shadow=False, deps=deps,
        event_received_at=_parse_received_at(received_at), turn_id=turn_id, is_reply=False,
        purpose="lead_response")
    return {"status": "done", "turn_id": log["turn_id"], "send_status": log["summary"].get("send_status")}


# PLAN_4 stream X1 item 1: the first reply held to the customer's next allowed time (scheduler/followups.py fires
# it through fire_held_first_reply). Not in followups.CHANNEL_SWITCHES' exclusions on purpose: the customer
# writing first cancels it, and their own message gets the reply instead.
KIND_FIRST_REPLY = "first_reply_held"


async def _first_reply(db: DealerScopedDatabase, deps: TurnDeps, *, customer_id: str, lead_id: str,
                       lead: dict | None, channel: str, shadow: bool, received_at: datetime | None, turn_id: str,
                       followup: dict | None = None) -> dict[str, Any]:
    """The first message on a new lead, as its own send-check class (PLAN_4 stream X1 item 1, TCPA PDF §4):
    `lead_response`, never a reply. Checked before anything is drafted: BLOCK / REVIEW sends nothing (the lead's
    other channel is tried), HOLD plans the first reply for the customer's next allowed time. An imported or
    otherwise non-consumer lead is checked as outbound marketing by the engine itself."""
    from upsell_agent.compliance.engine import can_contact

    if not shadow:
        customer = await find_customer(db, customer_id)
        if (followup is None and consent.FIRST_CHANNEL == "email" and channel == "sms"
                and await consent.usable_recipient(db, lead, customer, "email")):
            channel = "email"  # AI Studio channel rule: a new lead hears from us by email first
        check = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                  purpose="lead_response", is_reply=False, lead=lead, customer=customer,
                                  record=False)
        other = "email" if channel == "sms" else "sms"
        night = channel == "sms" and check.outcome == "HOLD" and check.until
        # AI Studio channel rule for a lead outside texting hours (consent.AT_NIGHT).
        # The user, 28 Oct 2026: one message at night, asking "now or business hours?" - never the first message again
        # by text in the morning (140 leads got both). The 13 Oct second copy is gone whatever AI Studio says.
        text_held = None
        # Client, 12 Oct 2026: a lead that arrives at night is answered at once by EMAIL (no quiet hours for email), with
        # the after-hours choice; only the text waits for the customer's legal texting hours.
        if check.outcome in ("BLOCK", "REVIEW", "HOLD") and not (night and consent.AT_NIGHT == "wait_for_text") \
                and await consent.usable_recipient(db, lead, customer, other):
            alt = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=other,
                                    purpose="lead_response", is_reply=False, lead=lead, customer=customer,
                                    record=False)
            if alt.outcome == "ALLOW" or (check.outcome != "HOLD" and alt.outcome == "HOLD"):
                channel, check = other, alt
        if check.outcome == "HOLD" and check.until:
            return await _hold_first_reply(db, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                           until=check.until, reason=check.reason, followup=followup,
                                           turn_id=turn_id)
        if check.outcome != "ALLOW":
            await _log_first_reply_not_sent(db, deps, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                            check=check, turn_id=turn_id)
            if followup:
                await _close_followup(db, followup, "suppressed", f"{check.outcome}: {check.reason}")
            return {"status": "not_sent", "turn_id": turn_id, "send_check": check.outcome, "rule": check.rule,
                    "reason": check.reason}

    log = await run_turn(
        dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id,
        trigger="lead_created", channel=channel, inbound_text=_comments(lead),
        shadow=shadow, deps=deps, event_received_at=received_at, turn_id=turn_id,
        is_reply=False, purpose="lead_response",
    )
    sent = log["summary"].get("send_status")
    if sent == "held" and not shadow:
        # The check changed between the look above and the send: plan it for the time it now gives.
        row = await _already_sent(db, turn_id) or {}
        until = row.get("held_until")
        if isinstance(until, datetime):
            await _hold_first_reply(db, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                    until=_aware(until), reason=row.get("reason") or "held by the send check",
                                    followup=followup, turn_id=turn_id)
            return {"status": "held", "turn_id": log["turn_id"], "until": _aware(until).isoformat()}
    if followup:
        await _close_followup(db, followup, "sent" if sent in ("sent", "duplicate") else (sent or "failed"),
                              log["outcome"])
    if not shadow and channel == "email" and text_held is not None and sent in ("sent", "duplicate"):
        # Client, 13 Oct 2026 (Timi Gabice, 11:10 PM, phone on the lead, only an email ever went out; Betsy: "email at
        # that time ... the text waits"): the first TEXT goes out when the customer's texting hours open - the full
        # first message (FTC introduction), so the morning "we're open" email isn't sent on top of it. Dropped if the
        # customer writes first (fire_held_first_reply).
        await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
            {"lead_id": lead_id, "kind": "resume_at_opening", "status": "pending"},
            {"$set": {"status": "superseded", "reason": "the first text goes out when texting hours open",
                      "closed_at": clock.now()}})
        held = await _hold_first_reply(db, customer_id=customer_id, lead_id=lead_id, channel="sms",
                                       until=text_held.until, reason=text_held.reason, followup=None,
                                       turn_id=f"{turn_id}:text")
        return {"status": "done", "turn_id": log["turn_id"], "outcome": log["outcome"], "send_status": sent,
                "text_held": held}
    return {"status": "done", "turn_id": log["turn_id"], "outcome": log["outcome"], "send_status": sent}


async def _hold_first_reply(db: DealerScopedDatabase, *, customer_id: str, lead_id: str, channel: str,
                            until: datetime, reason: str, followup: dict | None, turn_id: str) -> dict[str, Any]:
    followups = db.collection(SCHEDULED_FOLLOWUPS_COLLECTION)
    why = f"held by the send check: {reason}"
    if followup:
        await followups.update_one({"_id": followup["_id"], "status": "claimed"},
                                   {"$set": {"status": "pending", "due_at": until, "to_channel": channel,
                                             "reason": why}})
        followup_id = str(followup["_id"])
    else:
        await followups.update_many({"lead_id": lead_id, "kind": KIND_FIRST_REPLY, "status": "pending"},
                                    {"$set": {"status": "superseded", "closed_at": clock.now()}})
        inserted = await followups.insert_one({
            "kind": KIND_FIRST_REPLY, "lead_id": lead_id, "customer_id": customer_id, "source_turn_id": turn_id,
            "from_channel": channel, "to_channel": channel, "text": None, "subject": None, "status": "pending",
            "due_at": until, "created_at": clock.now(), "claim_count": 0, "reason": why})
        followup_id = str(inserted.inserted_id)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"first_reply_held": {"until": until, "reason": reason,
                                                             "followup_id": followup_id}}})
    return {"status": "held", "turn_id": turn_id, "until": until.isoformat(), "reason": reason,
            "followup_id": followup_id}


async def _close_followup(db: DealerScopedDatabase, doc: dict, status: str, reason: str) -> None:
    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
        {"_id": doc["_id"], "status": "claimed"},
        {"$set": {"status": status, "closed_at": clock.now(), "reason": reason}})


async def _log_first_reply_not_sent(db: DealerScopedDatabase, deps: TurnDeps, *, customer_id: str, lead_id: str,
                                    channel: str, check: Any, turn_id: str) -> None:
    """A turn log saying why the new lead got no first message (never silent), and the decision in the
    compliance log."""
    from upsell_agent.compliance.engine import can_contact

    logged = await can_contact(dealer_id=db.dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                               purpose="lead_response", is_reply=False, source="ai_first_reply",
                               request_id=f"{turn_id}:{channel}")
    tracer = TurnTracer(sink=deps.sink, dealer_id=db.dealer_id, lead_id=lead_id, customer_id=customer_id,
                        trigger="lead_created", channel=channel, store_prompts=deps.store_prompts,
                        turn_id=f"{turn_id}:not-sent")
    await tracer.start({"channel": channel, "text": ""})
    async with tracer.node("send_check", {"purpose": "lead_response", "channel": channel}) as span:
        span.output = logged.as_dict()
        span.reasoning = [f"{c['rule']}: {'ok' if c['passed'] else 'no'} - {c['detail']}" for c in logged.checks]
        span.edge_label = logged.outcome
    await tracer.skipped("send", f"The send check says {check.outcome}: {check.reason}")
    log = await tracer.finish("not_sent", {"send_check": check.outcome, "rule": check.rule, "reason": check.reason})
    await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)


async def fire_held_first_reply(db: DealerScopedDatabase, doc: dict, deps: TurnDeps) -> str:
    """The held first reply's time came (PLAN_4 stream X1 item 1): checked again, then sent, held again,
    or dropped (the customer wrote meanwhile, staff took over, the lead was linked to another)."""
    lead_id = doc["lead_id"]
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
    wrote = await db.collection(AI_MESSAGES_COLLECTION).find_one(
        {"lead_id": lead_id, "direction": "inbound", "created_at": {"$gt": doc["created_at"]}})
    turn_id = doc.get("source_turn_id") or first_reply_turn_id(lead_id)
    previous = await _already_sent(db, turn_id)
    why = ("the customer wrote first; their message got the reply" if wrote
           else f"the lead is {state['status']}" if state.get("status") in SILENT_STATUSES
           else "linked to another open lead" if state.get("duplicate_of")
           else "already answered" if previous and previous.get("status") != "held" else None)
    if why:
        await _close_followup(db, doc, "cancelled", why)
        return "cancelled"
    lead = await find_lead(db, lead_id)
    result = await _first_reply(db, deps, customer_id=doc["customer_id"], lead_id=lead_id, lead=lead,
                                channel=doc.get("to_channel") or "sms", shadow=False, received_at=None,
                                turn_id=turn_id, followup=doc)
    return {"held": "deferred", "not_sent": "suppressed"}.get(result["status"], result.get("send_status") or "sent")


# AI Studio > Compliance > Safeguards (26 Oct 2026): one customer, one conversation - a staff status on a linked duplicate
# lead is its stage; the AI keeps talking on the customer's open lead.
DUPLICATE_STAYS_QUIET = True
# An iPhone tapback relayed as SMS: 'Laughed at “...”', 'Liked "..."', 'Loved an image'.
_REACTION = re.compile(r"^\s*(?:Liked|Loved|Laughed at|Emphasized|Disliked|Questioned|Reacted\s+\S+\s+to)\s+"
                       r"(?:[“\"'].*[”\"']|an?\s+(?:image|attachment|message|link|video))\s*$", re.DOTALL)


async def record_inbound(event: InboundMessageEvent) -> str | None:
    """Saves the customer's message (idempotent on the platform message id)
    and returns its lead id. Called BEFORE the lead lock is taken
    (worker/jobs.py), so messages that arrive while a turn is running are
    already on record when the next turn looks for unanswered ones."""
    db = dealer_scoped_db(event.dealer_id)
    lead_id = event.lead_id
    if not lead_id:
        latest = sorted(await find_customer_leads(db, event.customer_id), key=lambda row: row["_id"], reverse=True)
        lead_id = str(latest[0]["_id"]) if latest else None
    # MASTER_PLAN_3 C6: a customer's message belongs to the lead the AI works, never to a linked duplicate.
    lead_id = await duplicates.workflow_lead_id(db, lead_id)
    saved = await db.collection(AI_MESSAGES_COLLECTION).update_one(
        {"platform_message_id": event.message_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": event.customer_id, "direction": "inbound",
                          "channel": event.channel, "text": event.text, "platform_message_id": event.message_id,
                          "created_at": event.received_at, "answered_turn_id": None}},
        upsert=True,
    )
    if saved.upserted_id is not None:
        # PLAN_4 stream L: the reply is credited to the lead's latest AI touch, once (learning/touches.py).
        # Timed by our clock (the one the touch was stamped with), so DEV's moved clock agrees.
        await touches.on_customer_reply(db, lead_id, text=event.text, at=clock.now())
    return lead_id


async def _mark_answered(db: DealerScopedDatabase, rows: list[dict], turn_id: str) -> None:
    for row in rows:
        await db.collection(AI_MESSAGES_COLLECTION).update_one({"_id": row["_id"]},
                                                               {"$set": {"answered_turn_id": turn_id}})


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


def _hold_decision(state: dict, request: str | None = None) -> tuple[str, str]:
    """(action, reason) for customer messages on a lead the AI doesn't answer. `request` (PLAN_4 stream X3 item 4):
    the customer asked to book or asked a question - they get a holding reply even inside the 2-hour window."""
    status, why = state["status"], state.get("status_reason")
    if status == "handoff":
        last = _aware(state.get("last_handoff_notice_at"))
        # A request to book is always acknowledged; a question at most every HOLDING_REPLY_MIN_GAP, counted from
        # the last holding reply (not from the handoff message itself); anything else every 2 hours.
        if request == "booking":
            last = None
        elif request:
            last = _aware(state.get("last_request_notice_at"))
        gap = after_handoff.HOLDING_REPLY_MIN_GAP if request else HOLDING_REPLY_EVERY
        if last and clock.now() - last < gap:
            return "saved_only", (f"The lead is with staff ({why or 'handed off'}); the customer was told at "
                                  f"{last:%H:%M} UTC that the team will reach out (at most one holding reply "
                                  f"every {HOLDING_REPLY_EVERY.total_seconds() / 3600:g} hours). Saved for staff.")
        return "holding_reply", f"The lead is with staff ({why or 'handed off'}): a holding reply, no AI."
    if status == "paused":
        return "saved_only", f"Paused: a person is handling this lead ({why or 'paused by staff'}). Saved for them."
    return "saved_only", f"The customer opted out ({why or 'opted out'}). Nothing is sent."


async def _tell_staff_after_handoff(db: DealerScopedDatabase, deps: TurnDeps, *, lead_id: str, customer_id: str,
                                    request: str, rows: list[dict], took_back: bool, why: str | None = None) -> None:
    """A staff notice and a CRM note with what the customer asked after the handoff (PLAN_4 stream X3 item 4)."""
    from upsell_agent.agent import crm_notes

    said = " / ".join(str(r.get("text") or "") for r in rows)[:600]
    if took_back and request != "booking":
        text = (f"The customer wrote again after asking for a person ({why or 'handed off'}): the AI is answering "
                f"their questions meanwhile - the call they asked for is still yours to make. They wrote: \"{said}\"")
    elif took_back:
        text = (f"The customer asked to book after the handoff ({why or 'handed off'}): the AI took the lead back "
                f"to book it. They wrote: \"{said}\"")
    elif request == "booking":
        text = f"The customer asked to book while the lead is with staff - please book it: \"{said}\""
    else:
        text = f"The customer asked a question while the lead is with staff - please answer: \"{said}\""
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
        "staff_notice": {"at": clock.now(), "kind": f"after_handoff_{request}", "text": text}}})
    await crm_notes.write(db, lead_id=lead_id, kind="after_handoff", text=text,
                          key=f"after-handoff-{rows[-1]['_id']}", platform=getattr(deps, "platform", None),
                          customer_id=customer_id)


async def _call_after_text_request(db: DealerScopedDatabase, deps: TurnDeps, *, lead_id: str, customer_id: str,
                                   state: dict, rows: list[dict]) -> None:
    """Ishmael Ballah, 26 Oct 2026: handed to staff as "wants a text, not a call", then wrote "Call is fine" - the
    message was only saved and the alert kept saying the opposite. The same alert is corrected (one handover per
    lead: no second alert) and a note says what they wrote."""
    from upsell_agent.agent import crm_notes

    notice = state.get("staff_notice") or {}
    said = " / ".join(str(r.get("text") or "") for r in rows)[:300]
    if notice.get("kind") != human_contact.NOTICE_TEXT_KIND or human_contact.said_method(said) != human_contact.CALL:
        return
    text = (f"The customer now says a call is fine - please call them (they first asked for a text). "
            f"They wrote: \"{said}\"")
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
        "staff_notice": {**notice, "at": clock.now(), "kind": human_contact.NOTICE_CALL_WAITING_KIND, "text": text,
                         "reason": human_contact.REASON_CALL}}})
    await crm_notes.write(db, lead_id=lead_id, kind="contact_change", text=text,
                          key=f"call-after-text-{rows[-1]['_id']}", platform=getattr(deps, "platform", None), customer_id=customer_id)


async def _record_held(db: DealerScopedDatabase, event: InboundMessageEvent, deps: TurnDeps, *, lead_id: str,
                       rows: list[dict], action: str, reason: str, received_at: datetime | None,
                       confirmation: str | None = None, reply: dict[str, Any] | None = None,
                       holding_kind: str = "holding") -> dict[str, Any]:
    """Logs a turn for customer messages the AI doesn't answer, saying why,
    and sends the holding reply when that's the action. Marks the messages
    answered by this turn, so none is left without a reply or a reason."""
    latest = rows[-1]
    turn_id = f"held-{latest['_id']}"
    if await db.collection(AI_TURN_LOG_COLLECTION).find_one({"turn_id": turn_id}, projection={"_id": 1}):
        await _mark_answered(db, rows, turn_id)  # a re-run of a job that already got this far
        return {"status": "already_answered", "turn_id": turn_id}
    channel = latest["channel"]
    tracer = TurnTracer(sink=deps.sink, dealer_id=event.dealer_id, lead_id=lead_id, customer_id=event.customer_id,
                        trigger="inbound_held", channel=channel, store_prompts=deps.store_prompts, turn_id=turn_id)
    await tracer.start({"text": "\n".join(r["text"] for r in rows), "channel": channel, "shadow": event.shadow,
                        "batch": [batch_entry(r) for r in rows]})
    # Client, 20 Oct 2026 (Bibi wrote in Spanish while a person handled her lead; her language stayed "English" and
    # the next replies went out in English): the language is recorded from every message, held or answered.
    from upsell_agent.agent.reply_language import detect, in_customer_language
    spoken = await detect("\n".join(r["text"] for r in rows), get_settings().model_extract)
    if spoken and spoken.strip().lower() not in ("unknown", "undetermined", "none", "n/a"):
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
            "customer_language": spoken, "reply_language": None if spoken == "English" else spoken}})
    async with tracer.node("hold", {"action": action, "messages": len(rows)}) as span:
        span.output = {"action": action, "reason": reason}
        span.reasoning = [reason]
        span.edge_label = "holding reply" if action == "holding_reply" else action.replace("_", " ")

    sent = None
    if action in ("holding_reply", "opt_out_confirmation") or reply:
        if reply:
            # A reply the AI composes in code rather than writes (MASTER_PLAN_3 C5: the answer to Y / N).
            text, subject, purpose = reply["text"], None if channel == "sms" else reply.get("subject"), "reply"
        elif action == "holding_reply":
            customer = await find_customer(db, event.customer_id)
            lead = await find_lead(db, lead_id)
            draft = render_holding_reply(holding_kind, (customer or {}).get("name") or (lead or {}).get("name"))
            text = draft["sms_text"] if channel == "sms" else draft["email_body"]
            subject, purpose = None if channel == "sms" else draft["email_subject"], "transactional"
        else:
            text, subject, purpose = confirmation or confirmation_text(("sms", "email", "voice")), \
                None if channel == "sms" else "Your request", "opt_out_confirmation"
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
        language = state.get("reply_language") or str(state.get("customer_language") or "").replace("English", "")
        text, note = await in_customer_language(text, language, get_settings().model_extract)
        subject, _ = await in_customer_language(subject, language, get_settings().model_extract)
        if note:
            tracer.log.setdefault("translations", []).append(note)
        request = SendRequest(
            dealer_id=event.dealer_id, lead_id=lead_id, customer_id=event.customer_id, turn_id=turn_id,
            channel=channel, text=text, subject=subject, shadow=event.shadow, event_received_at=received_at,
            purpose=purpose, is_reply=True, template_id=f"template:{action}")
        async with tracer.node("send", {"channel": channel, "idempotency_key": request.idempotency_key,
                                        "text": request.text, "subject": request.subject}) as span:
            sent = await deps.sender.send(request)
            span.output = sent.as_dict()
            span.reasoning = sent.reasoning
            span.metrics = {"attempts": sent.attempts, "event_to_send_ms": sent.latency_ms}
            span.edge_label = sent.status
        await tracer.skipped("schedule", "A holding reply never schedules a channel switch." if not reply
                             else "A reply to the customer's Y / N schedules nothing.")
        if sent.status == "sent" and action == "holding_reply":
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
                {"lead_id": lead_id}, {"$set": {"last_handoff_notice_at": clock.now(), "last_outbound_at": clock.now(),
                                                "last_send_status": sent.status}})
    else:
        await tracer.skipped("send", reason)
        await tracer.skipped("schedule", "Nothing was sent.")

    from upsell_agent.scheduler.sold_lifecycles import ROUTER_ACTIONS  # MASTER_PLAN_4 (stream A3)

    outcome = action if action in ("holding_reply", "opted_out", "opted_in", "opt_out_confirmation", "wrong_number",
                                   "auto_reply",
                                   *APPOINTMENT_ACTIONS, *ROUTER_ACTIONS) else "saved_only"
    log = await tracer.finish(outcome, {
        "action": action, "reason": reason, "reply": sent and request.text, "send_status": sent and sent.status,
        "batched": len(rows)})
    await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
    await _mark_answered(db, rows, turn_id)
    return {"status": outcome, "reason": reason, "turn_id": turn_id, "send_status": sent and sent.status}


async def handle_inbound_message(event: InboundMessageEvent, deps: TurnDeps,
                                 received_at: str | datetime | None = None) -> dict[str, Any]:
    await ai_studio.refresh()  # the settings published in AI Studio (upsell_agent/ai_studio.py)
    db = dealer_scoped_db(event.dealer_id)
    lead_id = await record_inbound(event)
    if not lead_id:
        return {"status": "saved_only", "reason": "no lead found for this customer"}
    await studio_cadences.start(db, lead_id=lead_id, customer_id=event.customer_id, channel=event.channel,
                                trigger={"type": "customer_says", "text": event.text})  # cadences added in AI Studio

    # Everything this customer sent that no turn has answered yet: three
    # quick texts get one reply, not three (architecture §5 step 5).
    unanswered = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": lead_id, "direction": "inbound", "answered_turn_id": None}).to_list(None)
    unanswered.sort(key=lambda m: m["created_at"])
    if not unanswered:
        return {"status": "already_answered", "reason": "an earlier turn answered this message"}

    if event.auto_reply or all(auto_reply.is_auto_reply(m["text"]) for m in unanswered):
        # PLAN_4 stream X3 item 10: an out-of-office / auto-responder. No reply (no loop with a bot), not contact
        # (no stage change, call tasks and the channel switch stay), only a record of why.
        await db.collection(AI_MESSAGES_COLLECTION).update_many(
            {"_id": {"$in": [m["_id"] for m in unanswered]}}, {"$set": {"auto_reply": True}})
        held = await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="auto_reply",
                                  reason="An auto-responder (out of office / automatic reply), not the customer: "
                                         "no reply, not counted as contact.",
                                  received_at=_parse_received_at(received_at))
        return {**held, "status": "auto_reply"}

    if all(_REACTION.match(str(m.get("text") or "")) for m in unanswered):
        # Joyce Capuano, 26 Oct 2026: "Laughed at “Thanks, Joyce. ...”" (an iPhone reaction sent as a text) got a full
        # reply, then her next message got another - two answers 25 s apart. A reaction is saved for staff, no reply.
        held = await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="saved_only",
                                  reason="An iPhone reaction to our message (Liked / Loved / Laughed at ...): saved, "
                                         "no reply.", received_at=_parse_received_at(received_at))
        return {**held, "status": "reaction"}

    # Step 1, before anything can fail: the customer replied, so no channel switch.
    cancelled = await _cancel_pending_followups(db, lead_id, channel_switches_only=True)

    lead = await find_lead(db, lead_id)
    state = await _ensure_lead_state(db, lead_id, event.customer_id, lead)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"last_inbound_at": event.received_at}}
    )
    if (not state.get("stage") and not state.get("last_turn_at") and not state.get("duplicate_of")
            and not event.shadow):
        # PLAN_4 stream X3 item 5: the AI first sees this lead through a reply (it was open before the dealer went
        # live, or its lead-created event was lost). Its stage and opportunity clock start from the CRM lead's own
        # creation date, so its cadence and its Day-91 close follow from where it stands, not from today.
        await lifecycle.apply(db, lead_id, [lifecycle.Event("lead_created", source="first_seen_on_reply")],
                              lead=lead, customer_id=event.customer_id)
        state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or state

    # Opt-outs, handled in code with no AI (architecture §5 step 3,
    # MASTER_PLAN_3 C1 item 3). A keyword stops its channel and the carrier
    # confirms it; a phrase stops the channel it names (every channel when it
    # names none) and gets one plain confirmation from us.
    customer = await find_customer(db, event.customer_id)
    asked = state.get("vehicle_updates_question") or (
        {"channels": ["sms"], "at": state["alerts_question_at"]} if state.get("alerts_question_at") else None)
    if asked and not event.shadow:
        # Betsy, 22 Oct 2026: the answer to "Is it still ok to send updates regarding your current vehicle(s) on file
        # (service & market values)?" after they asked us to stop about this inquiry. Yes: their vehicle updates carry
        # on (consent was never removed). No: every message we start on those channels stops. Anything else is a
        # new message, handled as one (it also turns this inquiry back on, below).
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": lead_id}, {"$unset": {"vehicle_updates_question": "", "alerts_question_at": ""}})
        said = "\n".join(m["text"] for m in unanswered)
        channels = tuple(asked.get("channels") or ["sms"])
        if _ALERTS_YES.match(said):
            if state.get("stage") == lifecycle.Stage.SOLD_DELIVERED.value or state.get("sold_delivered_at"):
                # This lead IS the delivered vehicle: its only messages are the updates they just said yes to
                # (service, anniversaries, market value) - nothing left to stop on it (review 23 Oct 2026).
                await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id},
                                                                         {"$unset": {"inquiry_opt_out": ""}})
            if state.get("alerts_question_at") and not state.get("vehicle_updates_question"):
                # Asked the 20 Oct question, when "don't text me" still opted the customer out: their yes turns texts
                # back on for the vehicle alerts, and this inquiry stays stopped.
                await consent.set_channel_consent(db, event.customer_id, "sms", True, source="customer_ownership_alerts",
                                                  lead_id=lead_id, address=_address(lead, customer, "sms"),
                                                  evidence={"message": unanswered[-1]["text"]})
                await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
                    {"lead_id": lead_id}, {"$set": {"inquiry_opt_out.sms": {"at": clock.now(), "said": "(20 Oct)"}}})
            return await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="opted_in",
                                      reason="The customer keeps updates about their vehicle(s) on file; this inquiry "
                                             "stays stopped.", received_at=_parse_received_at(received_at),
                                      reply={"text": opt_out_rules.VEHICLE_UPDATES_YES,
                                             "subject": "Your vehicle updates"})
        if _UPDATES_NO.match(said):
            for stopped in channels:
                await consent.set_channel_consent(
                    db, event.customer_id, stopped, False, source="customer_vehicle_updates_no", lead_id=lead_id,
                    address=_address(lead, customer, stopped), evidence={"message": unanswered[-1]["text"]})
            await _cancel_pending_followups(db, lead_id, channel_switches_only=False)
            return await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered,
                                      action="opt_out_confirmation",
                                      reason=f"No vehicle updates either: opted out of {', '.join(channels)}.",
                                      received_at=_parse_received_at(received_at),
                                      confirmation=confirmation_text(channels))
    for message in unanswered:
        keyword = consent.classify_keyword(message["text"])
        channel = message["channel"]
        opt_out = detect_opt_out(message["text"], channel)
        if opt_out and opt_out.kind == "phrase" and opt_out.channels != ("voice",) and not opt_out_rules.stops_everything(
                opt_out, message["text"]):
            return await _stop_this_inquiry(db, event, deps, lead=lead, customer=customer, lead_id=lead_id,
                                            rows=unanswered, opt_out=opt_out, message=message,
                                            received_at=received_at, cancelled=cancelled)
        if opt_out:
            # The lead's status isn't touched: the opt-out entries stop what we start on those
            # channels, and a later message from the customer still gets a reply (decision 137).
            for stopped in opt_out.channels:
                await consent.set_channel_consent(
                    db, event.customer_id, stopped, False,
                    source="customer_stop" if opt_out.kind == "keyword" else "customer_opt_out_phrase",
                    lead_id=lead_id, address=_address(lead, customer, stopped),
                    evidence={"message": message["text"], "matched": opt_out.matched,
                              "message_id": str(message["_id"]), "channel": channel})
            if opt_out.channels == ("voice",) and opt_out.kind == "phrase" and human_contact.asks_for_person(
                    message["text"]):
                # PLAN_4 stream H: "don't call me, can a person text me?" - calls stop (above), and the request
                # for a person goes on to the turn (a text from the team, never a call) instead of being
                # swallowed by the opt-out confirmation.
                continue
            scope = ", ".join(opt_out.channels)
            if not event.shadow and await _every_channel_stopped(db, event.customer_id):
                # MASTER_PLAN_3 C3: the stage is Opted Out only when nothing is left to contact them on;
                # a single-channel opt-out removes that channel and the rest carry on (Omnichannel PDF §15).
                await lifecycle.apply(db, lead_id, [lifecycle.Event(
                    "opted_out", source="customer_opt_out",
                    reason=f"Opted out of every channel ({opt_out.matched!r})")], lead=lead,
                    customer_id=event.customer_id)
                # PLAN_4 stream C1: staff see it in the CRM too - the lead goes to DND with a note.
                await _mark_lead_dnd(deps, event.dealer_id, lead_id,
                                     f"The customer opted out of every channel ({opt_out.matched!r}).")
            if opt_out.kind == "keyword":
                reason = (f"The customer replied STOP on {channel}: opted out. The carrier sends its own "
                          "confirmation, so nothing is sent.")
                action = "opted_out"
            else:
                reason = (f"The customer asked us to stop ({opt_out.matched!r}): opted out of {scope}. One plain "
                          f"confirmation goes out on {channel}.")
                action = "opt_out_confirmation"
            # A clear "stop everything" asks nothing back (Betsy, 22 Oct 2026); "don't text me" about this inquiry
            # took the branch above and asks about their vehicle updates.
            confirm = confirmation_text(opt_out.channels)
            await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action=action, reason=reason,
                               received_at=_parse_received_at(received_at), confirmation=confirm)
            return {"status": "opted_out", "channel": channel, "channels": list(opt_out.channels),
                    "kind": opt_out.kind, "followups_cancelled": cancelled}
        if wrong := suppression.detect_wrong_person(message["text"]):
            # MASTER_PLAN_3 C6: not the customer's number / email. It is marked invalid for good and nothing
            # more is sent to it (not even an apology); their other contact points, if any, carry on.
            address = await consent.usable_recipient(db, lead, customer, "email" if channel == "email" else "sms")
            result = await suppression.suppress_contact(
                db, channel="email" if channel == "email" else "sms", address=address,
                reason=f"the recipient said this is the wrong person ({wrong!r})", source="customer_wrong_person",
                customer_id=event.customer_id, lead_id=lead_id, stage=not event.shadow,
                evidence={"message": message["text"], "matched": wrong, "message_id": str(message["_id"])})
            reason = (f"The recipient said this is the wrong person ({wrong!r}): {address} is marked invalid and "
                      "never contacted again. Nothing is sent.")
            await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="wrong_number",
                               reason=reason, received_at=_parse_received_at(received_at))
            return {"status": "wrong_number", "channel": channel, "address": address,
                    "channels_left": result["channels_left"], "suppressed_lead": result["suppressed_lead"],
                    "followups_cancelled": cancelled}
        if keyword == "start" and await consent.is_opted_out(db, event.customer_id, channel,
                                                             _address(lead, customer, channel)):
            await consent.set_channel_consent(db, event.customer_id, channel, True, source="customer_start",
                                              lead_id=lead_id, address=_address(lead, customer, channel),
                                              evidence={"message": message["text"],
                                                        "message_id": str(message["_id"])})
            if state["status"] == "opted_out":  # a lead silenced before decision 137
                await _set_status(db, lead_id, "active", None)
            if not event.shadow:
                await lifecycle.apply(db, lead_id, [lifecycle.Event(
                    "opted_in", source="customer_start", reason=f"The customer replied START on {channel}",
                    detail={"previous": state.get("previous_stage"),  # X2: delivered -> never back to Sold Pending
                            "delivered": bool(state.get("sold_delivered_at"))})], lead=lead, customer_id=event.customer_id)
            await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="opted_in",
                               reason=f"The customer replied START on {channel}: opted back in. The carrier sends "
                                      "its own confirmation, so nothing is sent.",
                               received_at=_parse_received_at(received_at))
            return {"status": "opted_in", "channel": channel, "followups_cancelled": cancelled}
        if (channel == "sms" and text_consent.is_invite_answer(message["text"], state)
                and not await text_consent.has_text_consent(db, event.customer_id)):
            # Client, 9 Oct 2026: an owner who never consented to texts was invited by email to text YES; their
            # YES is their own written opt-in (TCPA spec §5: DealerVault data never is). Recorded, then confirmed.
            await text_consent.record_yes(db, customer_id=event.customer_id, lead_id=lead_id, message=message,
                                          address=_address(lead, customer, channel))
            return await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="text_consent",
                                      reason="The customer texted YES to the email invitation: text consent "
                                             "recorded.", received_at=_parse_received_at(received_at),
                                      reply={"text": text_consent.CONFIRMATION})
        if keyword is None and (opt_in := detect_opt_in(message["text"])):
            # "You can text me again": reverse it and carry on into a normal turn, so the rest of the
            # message is answered (decision 138).
            await _opt_back_in(db, event, lead, customer, lead_id, state, opt_in, message)
        if keyword is None and not event.shadow and not opt_out_rules.sounds_like_stop(message["text"]):
            # Betsy, 22 Oct 2026: "the customer sending any text, even just 'hi', opts the customer back in" - texts
            # and emails (a "don't call me" stays), and this inquiry if they had stopped it. The status then follows
            # from the conversation the turn below has with them.
            await _opt_back_in(db, event, lead, customer, lead_id, state,
                               OptIn(("sms", "email"), "any message from the customer"), message,
                               source="customer_message")
        if not event.shadow and state.get("inquiry_opt_out") and not opt_out_rules.sounds_like_stop(message["text"]):
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
                {"lead_id": lead_id}, {"$unset": {"inquiry_opt_out": ""}, "$set": {
                    "inquiry_opted_back_in": {"at": clock.now(), "message": message["text"][:300]}}})
            state = {**state, "inquiry_opt_out": None}

    # A possible opt-out under review is no longer resolved just because the customer wrote again (PLAN_4 stream
    # X1 item 3): the AI turn resolves it only on a clearly non-opt-out message that answers it
    # (agent/turn.py _resolve_review_if_answered); otherwise staff or an admin resume do (decision 72).

    _multi = await _resolve_multi_vehicle(db, event, lead_id, state, "\n".join(m["text"] for m in unanswered), lead)

    meaningful_now, _ = lifecycle.is_meaningful_reply("\n".join(m["text"] for m in unanswered))
    if meaningful_now and not event.shadow:
        # MASTER_PLAN_3 C2: contact within the 60 minutes (or while the task was open): no call needed.
        await cancel_call_task(db, lead_id, reason="the customer replied", include_open=True, keep_requested=True)

    handoff_request = (after_handoff.classify("\n".join(m["text"] for m in unanswered), clock.now())
                       if state["status"] == "handoff" and not event.shadow else None)
    if ((handoff_request == "booking" and after_handoff.is_soft_handoff(state))
            or (handoff_request and after_handoff.is_callback_request(state))):
        # PLAN_4 stream X3 item 4: the handoff needed no person's decision (an unsafe draft, or read as upset) and
        # the customer now asks to book: the AI takes the lead back and books it; staff are told.
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {
            "status": "active", "status_reason": None, "status_at": clock.now(), "resumed_at": clock.now(),
            "handoff_soft": None}})
        await _tell_staff_after_handoff(db, deps, lead_id=lead_id, customer_id=event.customer_id,
                                        request=handoff_request, rows=unanswered, took_back=True,
                                        why=state.get("status_reason"))
        state = {**state, "status": "active", "status_reason": None}

    if state["status"] in SILENT_STATUSES:
        # Staff own this conversation (or the customer opted out): the AI
        # doesn't reply, and these aren't answered later on resume either.
        meaningful, why = lifecycle.is_meaningful_reply("\n".join(m["text"] for m in unanswered))
        if meaningful and not event.shadow and state["status"] != "opted_out":
            # It's still contact (Omnichannel PDF §5), even with staff holding the conversation.
            await lifecycle.apply(db, lead_id, [lifecycle.Event("customer_replied", source="customer_reply",
                                                                reason=f"The customer replied: {why}")],
                                  lead=lead, customer_id=event.customer_id)
        if state["status"] == "handoff" and not event.shadow:
            await _call_after_text_request(db, deps, lead_id=lead_id, customer_id=event.customer_id,
                                           state=state, rows=unanswered)
        request = after_handoff.classify("\n".join(m["text"] for m in unanswered), clock.now()) \
            if state["status"] == "handoff" else None
        if request and not event.shadow:
            await _tell_staff_after_handoff(db, deps, lead_id=lead_id, customer_id=event.customer_id,
                                            request=request, rows=unanswered, took_back=False)
        action, reason = _hold_decision(state, request)
        held = await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action=action, reason=reason,
                                  received_at=_parse_received_at(received_at),
                                  holding_kind="holding_booking" if request == "booking" else "holding")
        if (meaningful and not event.shadow and state["status"] == "paused"
                and str(state.get("status_reason") or "").startswith(STAFF_REPLY_REASON)):
            # Client, 20 Oct 2026 (Betsy approved, Jeffry Turman): if no person answers, the AI picks it back up.
            await plan_staff_quiet(db, lead_id=lead_id, customer_id=event.customer_id,
                                   channel=unanswered[-1]["channel"], paused_at=state.get("paused_at"))
        if request and held.get("send_status") == "sent":
            await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
                {"lead_id": lead_id}, {"$set": {"last_request_notice_at": clock.now()}})
        return {**held, "followups_cancelled": cancelled}

    answered = await _appointment_answer(db, event, deps, lead=lead, lead_id=lead_id, state=state,
                                         rows=unanswered, received_at=_parse_received_at(received_at))
    if answered:
        return {**answered, "followups_cancelled": cancelled}
    from upsell_agent.agent import appointment as appointment_steps
    if (state.get("stage") == lifecycle.Stage.APPOINTMENT_SET.value
            and appointment_steps.is_closing_ack(" ".join(m["text"] for m in unanswered))):
        # Betsy, 27 Oct 2026 meeting: once the appointment is set, "ok" / "thanks" / "copy that" gets no reply.
        held = await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="no_reply_needed",
                                  reason="The appointment is set and the customer only acknowledged: nothing to "
                                         "answer, no reply.", received_at=_parse_received_at(received_at))
        return {**held, "followups_cancelled": cancelled}
    if state.get("stage") in (lifecycle.Stage.SOLD_PENDING.value, lifecycle.Stage.SOLD_DELIVERED.value,
                              lifecycle.Stage.CLOSED_NO_LONGER_OWNS.value) and not event.shadow:
        # MASTER_PLAN_4 D2/D4/D7 (stream A3): the SOLD PENDING response router (§9), the anniversary YES / NO and
        # the current-vehicle questions (SOLD-DELIVERED PDF §8), and the answer to a service offer. None: the AI
        # turn answers, under sold_pending.reply_hold (agent/nodes/decide.py).
        from upsell_agent.scheduler import sold_lifecycles
        routed = await sold_lifecycles.route_inbound(
            db, lead_id=lead_id, customer_id=event.customer_id, state=state, lead=lead,
            text="\n".join(m["text"] for m in unanswered))
        if routed:
            held = await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action=routed["action"],
                                      reason=routed["reason"], received_at=_parse_received_at(received_at),
                                      reply=routed["reply"])
            return {**held, "sold_route": routed["action"], "followups_cancelled": cancelled}

    latest = unanswered[-1]
    turn_id = reply_turn_id(latest["_id"])
    if previous := await _already_sent(db, turn_id):
        # A re-run of a turn that already answered these messages.
        await _mark_answered(db, unanswered, turn_id)
        return {"status": "already_answered", "turn_id": turn_id, "send_status": previous.get("status"),
                "followups_cancelled": cancelled}
    log = await run_turn(
        dealer_id=event.dealer_id, customer_id=event.customer_id, lead_id=lead_id,
        trigger="inbound_message", channel=latest["channel"],
        inbound_text="\n".join(m["text"] for m in unanswered),
        shadow=event.shadow, deps=deps, event_received_at=_parse_received_at(received_at),
        source_message_id=str(latest["_id"]), turn_id=turn_id,
        batch=[batch_entry(m) for m in unanswered],
    )
    await _mark_answered(db, unanswered, log["turn_id"])
    return {"status": "done", "turn_id": log["turn_id"], "outcome": log["outcome"],
            "send_status": log["summary"].get("send_status"), "followups_cancelled": cancelled,
            "batched": len(unanswered)}


async def _appointment_answer(db: DealerScopedDatabase, event: InboundMessageEvent, deps: TurnDeps, *,
                              lead: dict | None, lead_id: str, state: dict, rows: list[dict],
                              received_at: datetime | None) -> dict[str, Any] | None:
    """The customer's answer to the day-before confirmation (MASTER_PLAN_3 C5, Omnichannel PDF §8). Only while
    we're waiting for one: Y confirms the booking (and the appointment), N offers new times at once, a short
    reply that is neither gets one more "Y or N?", and anything longer or a question is simply a conversation
    (answered by the AI turn as usual, still waiting). Returns None when the message isn't an answer."""
    from upsell_agent.agent import appointment
    from upsell_agent.agent.conversation import VisitState, after_turn, load_conversation
    from upsell_agent.integrations.dealer_profile import dealer_profile
    from upsell_agent.tools import booking_tool

    appt_state = state.get("appointment") or {}
    confirmation = appt_state.get("confirmation") or {}
    text = " ".join(r["text"] for r in rows).strip()
    if state.get("stage") != lifecycle.Stage.APPOINTMENT_SET.value or (
            confirmation.get("status") != "asked" and not appointment.is_maybe(text)):
        return None
    answer = "maybe" if appointment.is_maybe(text) else appointment.classify_answer(text)
    if answer == "other" or (answer == "ambiguous" and confirmation.get("asked_again")):
        return None
    profile = await dealer_profile(event.dealer_id)
    customer = await find_customer(db, event.customer_id)
    name = (customer or {}).get("name") or (lead or {}).get("name")
    appt_at = appointment.appointment_at(tz=profile.tz, booking=await booking_tool.find_active_booking(
        event.dealer_id, lead), lead=lead, recorded=appt_state)
    now = clock.now()
    offered: list[str] = []
    if answer == "yes":
        kind, action = "confirmed", "appointment_confirmed"
        if appt_state.get("booking_id"):
            await deps.platform.update_booking(event.dealer_id, {
                "booking_id": appt_state["booking_id"], "booking_status": "confirmed",
                "dealer_timezone": profile.timezone})
        new_state = {"appointment.confirmed": True, "appointment.confirmed_at": now,
                     "appointment.confirmation": {**confirmation, "status": "confirmed", "answered_at": now}}
        why = "The customer replied Y: the appointment is confirmed."
    elif answer == "no":
        kind, action = "reschedule", "appointment_reschedule"
        existing = await booking_tool.existing_bookings(event.dealer_id, profile, now)
        available = booking_tool.available_times(profile, existing, now, exclude_lead_id=lead_id)
        times = booking_tool.format_offer(booking_tool.offer_times(available), profile)
        offered = [t["display"] for t in times]
        new_state = {"appointment.confirmed": False,
                     "appointment.confirmation": {**confirmation, "status": "declined", "answered_at": now}}
        why = "The customer replied N: not confirmed, new times offered at once."
    elif answer == "maybe":
        kind, action = "tentative", "appointment_tentative"
        new_state = {"appointment.confirmed": False, "appointment.tentative": True, "appointment.tentative_at": now,
                     "appointment.confirmation": {**confirmation, "status": "tentative", "answered_at": now}}
        why = "The customer isn't sure they can make it: the appointment stays, marked tentative (Betsy, 27 Oct 2026)."
        from upsell_agent.agent import crm_notes
        await crm_notes.write(db, lead_id=lead_id, kind="appointment_tentative", customer_id=event.customer_id,
                              key=f"tentative:{lead_id}:{appt_state.get('at')}", platform=deps.platform,
                              text=f"Appointment tentative - the customer wrote: \"{text[:300]}\". It stays on the "
                                   "calendar; a call may help.")
    else:
        kind, action = "clarify", "appointment_clarify"
        new_state = {"appointment.confirmation": {**confirmation, "asked_again": True}}
        why = "The reply was neither Y nor N: asked once more, nothing marked confirmed."
        times = []
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": new_state})
    text_out = appointment.reply_text(kind, customer_name=name, appt=appt_at, offered=offered or None)
    held = await _record_held(
        db, event, deps, lead_id=lead_id, rows=rows, action=action, reason=why, received_at=received_at,
        reply={"text": text_out, "subject": "Your appointment"})
    if kind == "reschedule" and held.get("send_status") in ("sent", "failed"):
        # The offered times are on the table: the customer's pick moves the booking (agent/nodes/decide.py).
        fresh = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) or {}
        conversation = load_conversation(fresh)
        record = (conversation.visit or VisitState()).model_copy(update={
            "offered_times": times, "offered_turn": conversation.turn + 1, "declined": False, "stopped": False,
            "held_over": 0, "why": "The customer said the appointment time no longer works: new times offered."})
        updated = after_turn(conversation, now=now, send_status=held["send_status"], shadow=False,
                             action="reschedule_offer", asked_slots=[], answered=[], new_questions=[],
                             used_template=True, promises=[], visit=record.model_dump())
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": lead_id}, {"$set": {"conversation": updated.model_dump(mode="json")}})
    return {**held, "appointment_answer": answer}


async def _mark_showed(db: DealerScopedDatabase, deps: TurnDeps | None, lead: dict | None, lead_id: str,
                       prior: dict) -> dict[str, Any] | None:
    """Staff set Visited on the appointment's day: the customer showed up, whatever time they arrived
    (MASTER_PLAN_3 C5, Omnichannel PDF §7, §10: "mark appointment.showed = true ... regardless of arrival
    time"). The booking is marked completed on the platform."""
    from upsell_agent.agent import appointment
    from upsell_agent.integrations.dealer_profile import dealer_profile
    from upsell_agent.tools import booking_tool

    if prior.get("stage") not in (lifecycle.Stage.APPOINTMENT_SET.value, lifecycle.Stage.NO_SHOW.value):
        return None
    profile = await dealer_profile(db.dealer_id)
    booking = await booking_tool.find_active_booking(db.dealer_id, lead)
    appt_at = appointment.appointment_at(tz=profile.tz, booking=booking, lead=lead, recorded=prior.get("appointment"))
    if appt_at is None or appt_at.date() != clock.now().astimezone(profile.tz).date():
        return {"showed": False, "reason": "the visit isn't on the appointment's day"}
    booking_id = (prior.get("appointment") or {}).get("booking_id") or (str(booking["_id"]) if booking else None)
    if booking_id and deps is not None:
        await deps.platform.update_booking(db.dealer_id, {
            "booking_id": booking_id, "booking_status": "completed", "showed": True,
            "dealer_timezone": profile.timezone})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"appointment.showed": True, "appointment.showed_at": clock.now()}})
    return {"showed": True, "booking_id": booking_id}


async def handle_lead_paused(event: LeadPausedEvent, deps: TurnDeps | None = None) -> dict[str, Any]:
    """Staff took the lead over (a manual reply, an admin take-over) or moved
    it to a status they own. MASTER_PLAN_3 C3: a status move also moves the
    lead's stage (lifecycle.STAFF_STATUS_EVENTS). "Appointment Booked" is the
    one status that doesn't pause the AI: the appointment workflow (C5) is the
    AI's to run for staff bookings too (decided with the user, 1 Oct 2026)."""
    db = dealer_scoped_db(event.dealer_id)
    staff_status = lifecycle.staff_status_from_reason(event.reason)
    outcome_status = lifecycle.manager_outcome_from_reason(event.reason)
    if staff_status or outcome_status:
        # A cadence added in AI Studio that starts when staff set this status (scheduler/studio_cadences.py).
        status_lead = await find_lead(db, event.lead_id)
        await studio_cadences.start(db, lead_id=event.lead_id, customer_id=lead_customer_id(status_lead, db.dealer_id),
                                    channel="sms", trigger={"type": "status", "status": staff_status or outcome_status})
    if not staff_status and not outcome_status and (primary := await duplicates.workflow_lead_id(
            db, event.lead_id)) not in (None, event.lead_id):
        # The AI switch on a repeat lead: the AI works the customer on their open lead, so it's turned off there.
        return await handle_lead_paused(event.model_copy(update={"lead_id": primary}), deps)
    stage_event = lifecycle.STAFF_STATUS_EVENTS.get(staff_status or "")
    outcome_event = lifecycle.STAFF_STATUS_EVENTS.get(outcome_status or "")
    if staff_status == "No Show":
        # MASTER_PLAN_3 C5: the AI owns the no-show messages for an AI dealer (the platform skips its own), so
        # staff marking a no-show sends ours now instead of at +1h. Nothing is paused: the no-show flow runs on.
        return {"status": "not_paused", "reason": "No Show: the AI runs the no-show messages",
                **await staff_no_show(db, event.lead_id)}
    stage_change = None
    extra: dict[str, Any] = {}
    final_event = outcome_event or stage_event
    if stage_event:
        lead = await find_lead(db, event.lead_id)
        customer_id = lead_customer_id(lead, db.dealer_id)
        prior = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": event.lead_id}) or {}
        detail: dict[str, Any] = {}
        if stage_event == "appointment_set":
            booking = (lead or {}).get("booking") or {}
            at = booking.get("booking_at") or booking.get("booking_date")
            detail["appointment"] = {"at": at.isoformat() if isinstance(at, datetime) else at,
                                     "time": booking.get("booking_time"), "by": "staff"}
        stage_change = await lifecycle.apply(db, event.lead_id, [lifecycle.Event(
            stage_event, source="staff_status", reason=f'Staff set the lead to "{staff_status}"', detail=detail)],
            lead=lead, customer_id=customer_id)
        if stage_event == "appointment_set" and customer_id:
            # The AI runs the appointment's messages for a staff booking too (MASTER_PLAN_3 C5).
            extra["appointment_timers"] = await plan_appointment_timers(
                db, lead_id=event.lead_id, customer_id=customer_id, lead=lead,
                turn_id=f"staff-booking-{event.event_id}", appointment_hint=detail["appointment"])
        if stage_event == "sales_visit":
            extra["showed"] = await _mark_showed(db, deps, lead, event.lead_id, prior)
        if outcome_event:
            # The manager's outcome after the visit (MASTER_PLAN_3 C5): applied right after it, in order.
            stage_change = await lifecycle.apply(db, event.lead_id, [lifecycle.Event(
                outcome_event, source="manager_outcome", reason=f'Manager outcome: "{outcome_status}"')],
                lead=lead, customer_id=customer_id)
    if final_event == "staff_closed_lost" and (stage_change or {}).get("stage") == lifecycle.Stage.SOLD_DELIVERED.value:
        # PLAN_4 stream X2 (SOLD-DELIVERED PDF §1-§2): a delivered sale isn't "lost" - it closes as No Longer Owns. The
        # CRM refuses this too (aiDnd.statusChangeError); an older CRM's event changes nothing and pauses nothing.
        return {"status": "refused", "reason": "Sold - Delivered isn't closed as lost", "stage_change": stage_change}
    if final_event == "appointment_set":
        return {"status": "not_paused", "reason": "Appointment Booked: the AI runs the appointment workflow",
                "stage_change": stage_change, **extra}
    if final_event in ("sold_pending", "sold_delivered"):
        # MASTER_PLAN_4 D1 (stream A3): the AI runs the SOLD PENDING workflow / the ownership lifecycle, so the lead
        # isn't paused; lifecycle.apply already started the one and stopped the others (scheduler/sold_lifecycles.py).
        return {"status": f"resumed_{final_event}", "stage_change": stage_change, **extra}
    if DUPLICATE_STAYS_QUIET and final_event in ("unsold", "staff_no_next_action", "staff_not_contacted") and ((await db.collection(
            AI_LEAD_STATE_COLLECTION).find_one({"lead_id": event.lead_id}, projection={"duplicate_of": 1})) or {}).get(
            "duplicate_of") and (
            await duplicates.workflow_lead_id(db, event.lead_id)) != event.lead_id:
        # Fayek Sif / Jesus Cameras, 26 Oct 2026: staff set a linked duplicate lead's status, the AI resumed it, and the
        # customer got follow-ups from both leads at the same minute. The staff status is the stage (applied above);
        # the conversation stays on the customer's open lead - one customer, one conversation.
        return {"status": "duplicate", "reason": "staff status recorded; the AI works the customer's open lead",
                "stage_change": stage_change, **extra}
    if final_event in ("unsold", "staff_no_next_action", "staff_not_contacted"):
        # Back to follow-up for 90 days (client, 1 Oct 2026, scope Q2): the AI takes the lead back, and the
        # fresh cadence's first touch is planned now.
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": event.lead_id}, {"$set": {"status": "active", "status_reason": None,
                                                  "resumed_at": clock.now()}})
        # Client, 20 Oct 2026 (Betsy: "nothing is happening with these leads the next day or in the same day. These
        # are hot leads"): a lead that was already in Short-Term (New Lead -> staff "Contact Made - No Next Action")
        # starts no new cadence, and a touch cancelled earlier left it with none. Whatever the stage did, the lead
        # leaves here with a touch planned.
        has_touch = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).find_one(
            {"lead_id": event.lead_id, "kind": "cadence_touch", "status": "pending"}, projection={"_id": 1})
        if (stage_change or {}).get("cadence_started") or not has_touch:
            lead = lead if stage_event else await find_lead(db, event.lead_id)
            customer_id = lead_customer_id(lead, db.dealer_id)
            if customer_id:
                extra["cadence_touch"] = await plan_cadence_touch(
                    db, lead_id=event.lead_id, customer_id=customer_id,
                    channel=((lead or {}).get("data") or {}).get("channel") or "sms",
                    turn_id=f"unsold-{event.event_id}", lead=lead, first_contact_done=True)
                if final_event == "unsold" and (extra["cadence_touch"] or {}).get("followup_id"):
                    # Client, 21 Oct 2026: AI Studio -> Cadences -> "Unsold" sets this first message.
                    from upsell_agent.agent.nodes.decide import UNSOLD_INSTRUCTION, UNSOLD_THEME
                    await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_one(
                        {"_id": as_object_id(extra["cadence_touch"]["followup_id"])},
                        {"$set": {"touch.theme": UNSOLD_THEME, "touch.theme_label": "After an Unsold visit",
                                  "touch.instruction": UNSOLD_INSTRUCTION}})
        return {"status": "resumed_unsold", "stage_change": stage_change, **extra}
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": event.lead_id},
        {"$set": {"status": "paused", "status_reason": event.reason or "Paused by staff", "paused_at": clock.now()},
         "$setOnInsert": {"lead_id": event.lead_id, "created_at": clock.now()}},
        upsert=True,
    )
    cancelled = await _cancel_pending_followups(db, event.lead_id, channel_switches_only=False)
    # Staff have the lead (a reply, a status move): no call task is needed, waiting or open.
    await cancel_call_task(db, event.lead_id, reason="staff took over the lead", include_open=True,
                           keep_requested=True)
    return {"status": "paused", "followups_cancelled": cancelled,
            **({"stage_change": stage_change} if stage_change else {}), **extra}


async def handle_booking_changed(event: BookingChangedEvent, deps: TurnDeps | None = None) -> dict[str, Any]:
    """Staff cancelled or moved the lead's booking in the CRM (PLAN_4 stream S): the appointment's steps are
    cancelled or re-planned now, not when the next one falls due. The booking is re-read from the CRM's own
    record (the event only says what happened), so a stale or repeated event changes nothing wrong."""
    from upsell_agent.tools import booking_tool

    db = dealer_scoped_db(event.dealer_id)
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": event.lead_id}) or {}
    stage = lifecycle.stage_of(state.get("stage"))
    if stage not in (lifecycle.Stage.APPOINTMENT_SET, lifecycle.Stage.NO_SHOW):
        return {"status": "not_needed", "reason": f"the lead is at {lifecycle.label(stage) or 'no stage'}, "
                                                  "not waiting on an appointment"}
    lead = await find_lead(db, event.lead_id)
    customer_id = (str((lead or {}).get("customer_id") or "") or state.get("customer_id")
                   or lead_customer_id(lead, db.dealer_id))
    if not customer_id:
        return {"status": "not_needed", "reason": "no customer on the lead"}
    channel = ((lead or {}).get("data") or {}).get("channel") or "sms"
    active = await booking_tool.find_active_booking(event.dealer_id, lead)
    if active is None:
        if not await booking_tool.booking_cancelled(event.dealer_id, lead):
            return {"status": "not_needed", "reason": "the lead has no booking of its own to act on"}
        moved = await appointment_cancelled_on_platform(
            db, lead_id=event.lead_id, customer_id=customer_id, lead=lead, customer=None, channel=channel,
            turn_id=f"booking-changed-{event.event_id}", source="crm_booking")
        return {"status": "appointment_cancelled", "stage_change": moved}
    if active.get("booking_status") == "confirmed" and event.change == "confirmed":
        # PLAN_4 stream X2 (Omnichannel PDF §7-§8 "Confirmed by AI/human", "Human phone confirmation"): staff confirmed
        # it in the CRM. The appointment is confirmed and the day-before Y / N isn't sent; nothing else changes.
        from upsell_agent.agent import appointment
        from upsell_agent.integrations.dealer_profile import dealer_profile

        profile = await dealer_profile(event.dealer_id)
        appt_at = appointment.appointment_at(tz=profile.tz, booking=active, lead=lead,
                                             recorded=state.get("appointment"))
        now = clock.now()
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": event.lead_id}, {"$set": {
            "appointment.confirmed": True, "appointment.confirmed_at": now, "appointment.confirmed_by": "staff",
            **({"appointment.at": appt_at.isoformat()} if appt_at else {}),
            "appointment.confirmation": {**((state.get("appointment") or {}).get("confirmation") or {}),
                                         "status": "confirmed", "answered_at": now, "by": "staff"}}})
        dropped = await db.collection(SCHEDULED_FOLLOWUPS_COLLECTION).update_many(
            {"lead_id": event.lead_id, "status": "pending", "kind": "appointment_confirm"},
            {"$set": {"status": "cancelled", "reason": "staff confirmed the appointment", "closed_at": now}})
        return {"status": "appointment_confirmed", "confirmation_cancelled": dropped.modified_count}
    moved = None
    if event.change == "moved" and stage == lifecycle.Stage.NO_SHOW:
        # Live, 24 Oct 2026 (Joshuah): his booking was moved to Sunday after the no-show check had fired for the old
        # Saturday time - a moved appointment is rescheduled, not a no-show: back to Appointment Set.
        moved = await lifecycle.apply(db, event.lead_id, [lifecycle.Event(
            "appointment_set", reason="Appointment rescheduled", detail={"rescheduled": True})], lead=lead,
            customer_id=customer_id)
    planned = await plan_appointment_timers(db, lead_id=event.lead_id, customer_id=customer_id, lead=lead,
                                            channel=channel, turn_id=f"booking-changed-{event.event_id}")
    return {"status": "appointment_replanned", "appointment_timers": planned,
            **({"stage_change": moved} if moved else {})}


def _address(lead: dict | None, customer: dict | None, channel: str) -> str | None:
    """The phone (SMS, voice) or email an opt-out is also kept under (decision 140)."""
    return consent.resolve_recipient(lead, customer, "email" if channel == "email" else "sms")


async def _opt_back_in(db: DealerScopedDatabase, event: InboundMessageEvent, lead: dict | None,
                       customer: dict | None, lead_id: str, state: dict, opt_in: Any, message: dict,
                       source: str = "customer_opt_in_phrase") -> list[str]:
    """A natural-language opt-in (decision 138): the channel it names, or every channel the customer
    is opted out of when it names none. An email unsubscribe reported by the email provider isn't
    reversed: the provider keeps refusing that address, and the client's rule is "if email is
    unsubscribed, do not email" (decision 143)."""
    every_off = await _every_channel_stopped(db, event.customer_id)
    reversed_: list[str] = []
    for channel in opt_in.channels or ("sms", "email", "voice"):
        address = _address(lead, customer, channel)
        entry = await consent.latest_opt_out(db, event.customer_id, channel, address)
        if not entry or entry["consent_status"] != "opted_out":
            continue
        if channel == "email" and str(entry.get("consent_source") or "").startswith("sendgrid_"):
            continue
        await consent.set_channel_consent(db, event.customer_id, channel, True, source=source,
                                          lead_id=lead_id, address=address,
                                          evidence={"message": message["text"], "matched": opt_in.matched,
                                                    "message_id": str(message["_id"])})
        reversed_.append(channel)
    if reversed_ and every_off and not event.shadow:
        await lifecycle.apply(db, lead_id, [lifecycle.Event(
            "opted_in", source=source,
            reason=f"The customer opted back in ({opt_in.matched!r}): {', '.join(reversed_)}",
            detail={"previous": state.get("previous_stage"),  # X2: delivered -> never back to Sold Pending
                            "delivered": bool(state.get("sold_delivered_at"))})], lead=lead, customer_id=event.customer_id)
    return reversed_


_UPDATES_NO = re.compile(r"^\W*(?:n|no|nope|nah|no\s+thanks?|no\s+thank\s+you|not\s+interested|don'?t|do\s+not|"
                         r"no\s+updates?|nothing|none)\W*$", re.IGNORECASE)


async def _stop_this_inquiry(db: DealerScopedDatabase, event: InboundMessageEvent, deps: TurnDeps, *,
                             lead: dict | None, customer: dict | None, lead_id: str, rows: list[dict], opt_out: Any,
                             message: dict, received_at: Any, cancelled: int) -> dict[str, Any]:
    """Betsy, 22 Oct 2026: "don't text me" stops THIS inquiry on that channel (compliance/engine.py blocks every
    message we start on this lead and channel), not the customer: their consent stays, so the owner and service side
    and a later inquiry carry on, and any message from them turns it back on. The reply is her wording, plus the
    vehicle-updates question when they have a vehicle on file."""
    channels = tuple(c for c in opt_out.channels if c != "voice")
    now = clock.now()
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    if not event.shadow:
        # "Stop contacting me" names no channel: this lead's staff calls stop too (compliance/call_check.py).
        await states.update_one({"lead_id": lead_id}, {"$set": {
            **{f"inquiry_opt_out.{c}": {"at": now, "said": message["text"][:300], "matched": opt_out.matched}
               for c in opt_out.channels}}})
        await _cancel_pending_followups(db, lead_id, channel_switches_only=False)
        if "voice" in opt_out.channels:
            await cancel_call_task(db, lead_id, reason="the customer asked us to stop contacting them about this "
                                                       "inquiry", include_open=True, keep_requested=False)
    confirm = opt_out_rules.INQUIRY_CONFIRMATION.format(verb=opt_out_rules.inquiry_verb(channels))
    own = await states.find_one({"lead_id": lead_id}, projection={"stage": 1, "sold_delivered_at": 1}) or {}
    owner = not event.shadow and (own.get("stage") == lifecycle.Stage.SOLD_DELIVERED.value
                                  or bool(own.get("sold_delivered_at"))
                                  or await _owns_vehicle(db, event.customer_id))
    if owner:
        confirm = f"{confirm} {opt_out_rules.VEHICLE_UPDATES_QUESTION}"
        await states.update_one({"lead_id": lead_id}, {"$set": {
            "vehicle_updates_question": {"at": now, "channels": list(channels)}}})
    await _record_held(db, event, deps, lead_id=lead_id, rows=rows, action="opt_out_confirmation",
                       reason=(f"The customer asked us to stop about this inquiry ({opt_out.matched!r}): nothing more "
                               f"is started on {', '.join(channels)} for this lead; their consent stays"
                               + ("; asked whether to keep updates about their vehicle(s) on file." if owner else ".")),
                       received_at=_parse_received_at(received_at), confirmation=confirm)
    return {"status": "opted_out", "scope": "inquiry", "channel": message["channel"], "channels": list(channels),
            "kind": opt_out.kind, "followups_cancelled": cancelled, "asked_vehicle_updates": owner}


async def _mark_lead_dnd(deps: TurnDeps | None, dealer_id: str, lead_id: str, reason: str) -> None:
    """The CRM's own DND for a customer who opted out of everything (PLAN_4 stream C1). Never raises: the
    opt-out itself is already recorded and enforced here; the CRM's copy is for staff."""
    if deps is None:
        return
    try:
        await deps.platform.mark_lead_dnd(dealer_id, lead_id, reason)
    except Exception:  # the opt-out stands whatever the CRM answers
        logger.exception("could not set lead %s to DND in the CRM", lead_id)


async def _every_channel_stopped(db: DealerScopedDatabase, customer_id: str | None) -> bool:
    """Both SMS and email are opted out for this customer (MASTER_PLAN_3 C3:
    only then is the stage Opted Out / Suppressed)."""
    if not customer_id:
        return False
    return all([await consent.is_opted_out(db, customer_id, "sms"),
                await consent.is_opted_out(db, customer_id, "email")])


async def _resolve_review(db: DealerScopedDatabase, customer_id: str | None, lead_id: str, source: str,
                          evidence: dict[str, Any]) -> bool:
    if not customer_id or not await consent.open_review(db, customer_id):
        return False
    await consent.record_consent(db, customer_id=customer_id, channel="all", consent_type="review",
                                 status="resolved", source=source, lead_id=lead_id, evidence=evidence)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"compliance_review": None}})
    return True


async def handle_lead_resumed(event: LeadResumedEvent) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    # An admin resuming the AI resolves an open review (decision 72).
    state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": event.lead_id}) or {}
    # Client, 12 Oct 2026 (AI toggle bug fix, SOW item 21): a legal opt-out is never undone by the toggle.
    if state.get("status") == "opted_out" or state.get("stage") == lifecycle.Stage.OPTED_OUT.value:
        return {"status": "blocked", "reason": "The customer opted out: the AI stays off until they text START."}
    if state.get("duplicate_of") and (primary := await duplicates.workflow_lead_id(db, event.lead_id)) != event.lead_id:
        # A repeat lead runs on the customer's open lead (agent/duplicates.py), so turning the AI on here turns it on
        # there. Before, this was refused silently and the switch "couldn't be turned back on" (client, 12 Oct 2026).
        resumed = await handle_lead_resumed(event.model_copy(update={"lead_id": primary})) if primary else {}
        return {"status": "duplicate", "workflow_lead_id": primary, "primary": resumed}
    await _resolve_review(db, state.get("customer_id"), event.lead_id, "admin_resumed_ai", {})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": event.lead_id},
        {"$set": {"status": "active", "status_reason": None, "resumed_at": clock.now()},
         "$setOnInsert": {"lead_id": event.lead_id, "created_at": clock.now()}},
        upsert=True,
    )
    # PLAN_4 stream X2 (audit 1 blocker): the pause cancelled the lead's pending work; the AI has it again, so the
    # workflow of its current stage is planned again (cadence continued, not restarted; Day 91 clock untouched).
    replanned = await replan_workflow(db, event.lead_id, reason="staff resumed the AI")
    return {"status": "active", "replanned": replanned}
