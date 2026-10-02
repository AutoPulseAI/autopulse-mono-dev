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

from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import lifecycle
from upsell_agent.agent.templates import render_holding_reply
from upsell_agent.agent.turn import (
    TurnDeps,
    find_customer,
    find_lead,
    lead_type_from_lead,
    run_turn,
)
from upsell_agent.channels import consent
from upsell_agent.channels.sender import SendRequest
from upsell_agent.compliance.opt_out import confirmation_text, detect_opt_in, detect_opt_out
from upsell_agent.events.models import (
    InboundMessageEvent,
    LeadCreatedEvent,
    LeadPausedEvent,
    LeadResumedEvent,
)
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.observability.trace import TurnTracer
from upsell_agent.scheduler.followups import (
    CHANNEL_SWITCHES,
    plan_appointment_timers,
    plan_cadence_touch,
)

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
    return str(data.get("comments") or lead.get("comments") or "")


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


async def handle_lead_created(event: LeadCreatedEvent, deps: TurnDeps,
                              received_at: str | datetime | None = None) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    lead = await find_lead(db, event.lead_id)
    state = await _ensure_lead_state(db, event.lead_id, event.customer_id, lead)
    if not event.shadow:
        # MASTER_PLAN_3 C3: the lead's stage and its opportunity clock start here.
        await lifecycle.apply(db, event.lead_id, [lifecycle.Event("lead_created", source="lead_created")],
                              lead=lead, customer_id=event.customer_id)
    if state["status"] in SILENT_STATUSES:
        return {"status": "skipped", "reason": f"lead is {state['status']}"}
    turn_id = first_reply_turn_id(event.lead_id)
    if previous := await _already_sent(db, turn_id):
        return {"status": "already_answered", "turn_id": turn_id, "send_status": previous.get("status")}

    log = await run_turn(
        dealer_id=event.dealer_id, customer_id=event.customer_id, lead_id=event.lead_id,
        trigger="lead_created", channel=event.channel, inbound_text=_comments(lead),
        shadow=event.shadow, deps=deps, event_received_at=_parse_received_at(received_at), turn_id=turn_id,
    )
    return {"status": "done", "turn_id": log["turn_id"], "outcome": log["outcome"],
            "send_status": log["summary"].get("send_status")}


async def record_inbound(event: InboundMessageEvent) -> str | None:
    """Saves the customer's message (idempotent on the platform message id)
    and returns its lead id. Called BEFORE the lead lock is taken
    (worker/jobs.py), so messages that arrive while a turn is running are
    already on record when the next turn looks for unanswered ones."""
    db = dealer_scoped_db(event.dealer_id)
    lead_id = event.lead_id
    if not lead_id:
        latest = await db.collection(PLATFORM_LEADS_COLLECTION).find(
            {"customer_id": {"$in": [event.customer_id, as_object_id(event.customer_id)]}}
        ).sort("_id", -1).to_list(1)
        lead_id = str(latest[0]["_id"]) if latest else None
    await db.collection(AI_MESSAGES_COLLECTION).update_one(
        {"platform_message_id": event.message_id},
        {"$setOnInsert": {"lead_id": lead_id, "customer_id": event.customer_id, "direction": "inbound",
                          "channel": event.channel, "text": event.text, "platform_message_id": event.message_id,
                          "created_at": event.received_at, "answered_turn_id": None}},
        upsert=True,
    )
    return lead_id


async def _mark_answered(db: DealerScopedDatabase, rows: list[dict], turn_id: str) -> None:
    for row in rows:
        await db.collection(AI_MESSAGES_COLLECTION).update_one({"_id": row["_id"]},
                                                               {"$set": {"answered_turn_id": turn_id}})


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


def _hold_decision(state: dict) -> tuple[str, str]:
    """(action, reason) for customer messages on a lead the AI doesn't answer."""
    status, why = state["status"], state.get("status_reason")
    if status == "handoff":
        last = _aware(state.get("last_handoff_notice_at"))
        if last and clock.now() - last < HOLDING_REPLY_EVERY:
            return "saved_only", (f"The lead is with staff ({why or 'handed off'}); the customer was told at "
                                  f"{last:%H:%M} UTC that the team will reach out (at most one holding reply "
                                  f"every {HOLDING_REPLY_EVERY.total_seconds() / 3600:g} hours). Saved for staff.")
        return "holding_reply", f"The lead is with staff ({why or 'handed off'}): a holding reply, no AI."
    if status == "paused":
        return "saved_only", f"Paused: a person is handling this lead ({why or 'paused by staff'}). Saved for them."
    return "saved_only", f"The customer opted out ({why or 'opted out'}). Nothing is sent."


async def _record_held(db: DealerScopedDatabase, event: InboundMessageEvent, deps: TurnDeps, *, lead_id: str,
                       rows: list[dict], action: str, reason: str, received_at: datetime | None,
                       confirmation: str | None = None, reply: dict[str, Any] | None = None) -> dict[str, Any]:
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
            draft = render_holding_reply("holding", (customer or {}).get("name") or (lead or {}).get("name"))
            text = draft["sms_text"] if channel == "sms" else draft["email_body"]
            subject, purpose = None if channel == "sms" else draft["email_subject"], "transactional"
        else:
            text, subject, purpose = confirmation or confirmation_text(("sms", "email", "voice")), \
                None if channel == "sms" else "Your request", "opt_out_confirmation"
        request = SendRequest(
            dealer_id=event.dealer_id, lead_id=lead_id, customer_id=event.customer_id, turn_id=turn_id,
            channel=channel, text=text, subject=subject, shadow=event.shadow, event_received_at=received_at,
            purpose=purpose, is_reply=True)
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

    outcome = action if action in ("holding_reply", "opted_out", "opted_in", "opt_out_confirmation",
                                   *APPOINTMENT_ACTIONS) else "saved_only"
    log = await tracer.finish(outcome, {
        "action": action, "reason": reason, "reply": sent and request.text, "send_status": sent and sent.status,
        "batched": len(rows)})
    await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
    await _mark_answered(db, rows, turn_id)
    return {"status": outcome, "reason": reason, "turn_id": turn_id, "send_status": sent and sent.status}


async def handle_inbound_message(event: InboundMessageEvent, deps: TurnDeps,
                                 received_at: str | datetime | None = None) -> dict[str, Any]:
    db = dealer_scoped_db(event.dealer_id)
    lead_id = await record_inbound(event)
    if not lead_id:
        return {"status": "saved_only", "reason": "no lead found for this customer"}

    # Everything this customer sent that no turn has answered yet: three
    # quick texts get one reply, not three (architecture §5 step 5).
    unanswered = await db.collection(AI_MESSAGES_COLLECTION).find(
        {"lead_id": lead_id, "direction": "inbound", "answered_turn_id": None}).to_list(None)
    unanswered.sort(key=lambda m: m["created_at"])
    if not unanswered:
        return {"status": "already_answered", "reason": "an earlier turn answered this message"}

    # Step 1, before anything can fail: the customer replied, so no channel switch.
    cancelled = await _cancel_pending_followups(db, lead_id, channel_switches_only=True)

    lead = await find_lead(db, lead_id)
    state = await _ensure_lead_state(db, lead_id, event.customer_id, lead)
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"last_inbound_at": event.received_at}}
    )

    # Opt-outs, handled in code with no AI (architecture §5 step 3,
    # MASTER_PLAN_3 C1 item 3). A keyword stops its channel and the carrier
    # confirms it; a phrase stops the channel it names (every channel when it
    # names none) and gets one plain confirmation from us.
    customer = await find_customer(db, event.customer_id)
    for message in unanswered:
        keyword = consent.classify_keyword(message["text"])
        channel = message["channel"]
        opt_out = detect_opt_out(message["text"], channel)
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
            scope = ", ".join(opt_out.channels)
            if not event.shadow and await _every_channel_stopped(db, event.customer_id):
                # MASTER_PLAN_3 C3: the stage is Opted Out only when nothing is left to contact them on;
                # a single-channel opt-out removes that channel and the rest carry on (Omnichannel PDF §15).
                await lifecycle.apply(db, lead_id, [lifecycle.Event(
                    "opted_out", source="customer_opt_out",
                    reason=f"Opted out of every channel ({opt_out.matched!r})")], lead=lead,
                    customer_id=event.customer_id)
            if opt_out.kind == "keyword":
                reason = (f"The customer replied STOP on {channel}: opted out. The carrier sends its own "
                          "confirmation, so nothing is sent.")
                action = "opted_out"
            else:
                reason = (f"The customer asked us to stop ({opt_out.matched!r}): opted out of {scope}. One plain "
                          f"confirmation goes out on {channel}.")
                action = "opt_out_confirmation"
            await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action=action, reason=reason,
                               received_at=_parse_received_at(received_at),
                               confirmation=confirmation_text(opt_out.channels))
            return {"status": "opted_out", "channel": channel, "channels": list(opt_out.channels),
                    "kind": opt_out.kind, "followups_cancelled": cancelled}
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
                    detail={"previous": state.get("previous_stage")})], lead=lead, customer_id=event.customer_id)
            await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action="opted_in",
                               reason=f"The customer replied START on {channel}: opted back in. The carrier sends "
                                      "its own confirmation, so nothing is sent.",
                               received_at=_parse_received_at(received_at))
            return {"status": "opted_in", "channel": channel, "followups_cancelled": cancelled}
        if keyword is None and (opt_in := detect_opt_in(message["text"])):
            # "You can text me again": reverse it and carry on into a normal turn, so the rest of the
            # message is answered (decision 138).
            await _opt_back_in(db, event, lead, customer, lead_id, state, opt_in, message)

    # A possible opt-out under review is resolved by the customer writing
    # again with something that isn't one (decision 72). This message may
    # open a new review in its own turn.
    await _resolve_review(db, event.customer_id, lead_id, "customer_wrote_again",
                          {"message": unanswered[-1]["text"]})

    if state["status"] in SILENT_STATUSES:
        # Staff own this conversation (or the customer opted out): the AI
        # doesn't reply, and these aren't answered later on resume either.
        meaningful, why = lifecycle.is_meaningful_reply("\n".join(m["text"] for m in unanswered))
        if meaningful and not event.shadow and state["status"] != "opted_out":
            # It's still contact (Omnichannel PDF §5), even with staff holding the conversation.
            await lifecycle.apply(db, lead_id, [lifecycle.Event("customer_replied", source="customer_reply",
                                                                reason=f"The customer replied: {why}")],
                                  lead=lead, customer_id=event.customer_id)
        action, reason = _hold_decision(state)
        held = await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action=action, reason=reason,
                                  received_at=_parse_received_at(received_at))
        return {**held, "followups_cancelled": cancelled}

    answered = await _appointment_answer(db, event, deps, lead=lead, lead_id=lead_id, state=state,
                                         rows=unanswered, received_at=_parse_received_at(received_at))
    if answered:
        return {**answered, "followups_cancelled": cancelled}

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
    if state.get("stage") != lifecycle.Stage.APPOINTMENT_SET.value or confirmation.get("status") != "asked":
        return None
    text = " ".join(r["text"] for r in rows).strip()
    answer = appointment.classify_answer(text)
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
            "booking_id": booking_id, "booking_status": "completed", "dealer_timezone": profile.timezone})
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
    stage_event = lifecycle.STAFF_STATUS_EVENTS.get(staff_status or "")
    outcome_event = lifecycle.STAFF_STATUS_EVENTS.get(outcome_status or "")
    stage_change = None
    extra: dict[str, Any] = {}
    final_event = outcome_event or stage_event
    if stage_event:
        lead = await find_lead(db, event.lead_id)
        customer_id = str((lead or {}).get("customer_id") or "") or None
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
    if final_event == "appointment_set":
        return {"status": "not_paused", "reason": "Appointment Booked: the AI runs the appointment workflow",
                "stage_change": stage_change, **extra}
    if final_event == "unsold":
        # Back to follow-up for 90 days (client, 1 Oct 2026, scope Q2): the AI takes the lead back, and the
        # fresh cadence's first touch is planned now.
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": event.lead_id}, {"$set": {"status": "active", "status_reason": None,
                                                  "resumed_at": clock.now()}})
        if (stage_change or {}).get("cadence_started"):
            lead = lead if stage_event else await find_lead(db, event.lead_id)
            customer_id = str((lead or {}).get("customer_id") or "") or None
            if customer_id:
                extra["cadence_touch"] = await plan_cadence_touch(
                    db, lead_id=event.lead_id, customer_id=customer_id,
                    channel=((lead or {}).get("data") or {}).get("channel") or "sms",
                    turn_id=f"unsold-{event.event_id}", lead=lead, first_contact_done=True)
        return {"status": "resumed_unsold", "stage_change": stage_change, **extra}
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": event.lead_id},
        {"$set": {"status": "paused", "status_reason": event.reason or "Paused by staff", "paused_at": clock.now()},
         "$setOnInsert": {"lead_id": event.lead_id, "created_at": clock.now()}},
        upsert=True,
    )
    cancelled = await _cancel_pending_followups(db, event.lead_id, channel_switches_only=False)
    return {"status": "paused", "followups_cancelled": cancelled,
            **({"stage_change": stage_change} if stage_change else {}), **extra}


def _address(lead: dict | None, customer: dict | None, channel: str) -> str | None:
    """The phone (SMS, voice) or email an opt-out is also kept under (decision 140)."""
    return consent.resolve_recipient(lead, customer, "email" if channel == "email" else "sms")


async def _opt_back_in(db: DealerScopedDatabase, event: InboundMessageEvent, lead: dict | None,
                       customer: dict | None, lead_id: str, state: dict, opt_in: Any, message: dict) -> list[str]:
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
        await consent.set_channel_consent(db, event.customer_id, channel, True, source="customer_opt_in_phrase",
                                          lead_id=lead_id, address=address,
                                          evidence={"message": message["text"], "matched": opt_in.matched,
                                                    "message_id": str(message["_id"])})
        reversed_.append(channel)
    if reversed_ and every_off and not event.shadow:
        await lifecycle.apply(db, lead_id, [lifecycle.Event(
            "opted_in", source="customer_opt_in_phrase",
            reason=f"The customer opted back in ({opt_in.matched!r}): {', '.join(reversed_)}",
            detail={"previous": state.get("previous_stage")})], lead=lead, customer_id=event.customer_id)
    return reversed_


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
    await _resolve_review(db, state.get("customer_id"), event.lead_id, "admin_resumed_ai", {})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": event.lead_id},
        {"$set": {"status": "active", "status_reason": None, "resumed_at": clock.now()},
         "$setOnInsert": {"lead_id": event.lead_id, "created_at": clock.now()}},
        upsert=True,
    )
    return {"status": "active"}
