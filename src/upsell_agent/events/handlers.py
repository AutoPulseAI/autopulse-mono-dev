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
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import duplicates, human_contact, lifecycle
from upsell_agent.agent.templates import render_holding_reply
from upsell_agent.agent.turn import (
    TurnDeps,
    find_customer,
    find_lead,
    lead_type_from_lead,
    run_turn,
)
from upsell_agent.channels import consent, suppression
from upsell_agent.channels.sender import SendRequest
from upsell_agent.compliance.opt_out import confirmation_text, detect_opt_in, detect_opt_out
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
    PLATFORM_LEADS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.learning import touches
from upsell_agent.observability.trace import TurnTracer
from upsell_agent.scheduler.followups import (
    CHANNEL_SWITCHES,
    SOLD_LIFECYCLE_KINDS,
    appointment_cancelled_on_platform,
    cancel_call_task,
    plan_appointment_timers,
    plan_cadence_touch,
    replan_workflow,
    staff_no_show,
)

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
        flt["kind"] = {"$nin": [*SOLD_LIFECYCLE_KINDS, "daily_call_task"]}
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
    if not state.get("duplicate_of") and (primary := await duplicates.find_primary(db, lead)):
        # MASTER_PLAN_3 C6: the same customer already has an open lead the AI is working. This one is
        # linked to it; no first reply, no cadence, no second workflow.
        linked = await duplicates.link_duplicate(db, event.lead_id, event.customer_id, primary)
        return {"status": "duplicate", "reason": f"same customer as open lead {primary['lead_id']}", **linked}
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

    from upsell_agent.scheduler.sold_lifecycles import ROUTER_ACTIONS  # MASTER_PLAN_4 (stream A3)

    outcome = action if action in ("holding_reply", "opted_out", "opted_in", "opt_out_confirmation", "wrong_number",
                                   *APPOINTMENT_ACTIONS, *ROUTER_ACTIONS) else "saved_only"
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
            await _record_held(db, event, deps, lead_id=lead_id, rows=unanswered, action=action, reason=reason,
                               received_at=_parse_received_at(received_at),
                               confirmation=confirmation_text(opt_out.channels))
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
        if keyword is None and (opt_in := detect_opt_in(message["text"])):
            # "You can text me again": reverse it and carry on into a normal turn, so the rest of the
            # message is answered (decision 138).
            await _opt_back_in(db, event, lead, customer, lead_id, state, opt_in, message)

    # A possible opt-out under review is resolved by the customer writing
    # again with something that isn't one (decision 72). This message may
    # open a new review in its own turn.
    await _resolve_review(db, event.customer_id, lead_id, "customer_wrote_again",
                          {"message": unanswered[-1]["text"]})

    meaningful_now, _ = lifecycle.is_meaningful_reply("\n".join(m["text"] for m in unanswered))
    if meaningful_now and not event.shadow:
        # MASTER_PLAN_3 C2: contact within the 60 minutes (or while the task was open): no call needed.
        await cancel_call_task(db, lead_id, reason="the customer replied", include_open=True, keep_requested=True)

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
    customer_id = str((lead or {}).get("customer_id") or state.get("customer_id") or "") or None
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
    planned = await plan_appointment_timers(db, lead_id=event.lead_id, customer_id=customer_id, lead=lead,
                                            channel=channel, turn_id=f"booking-changed-{event.event_id}")
    return {"status": "appointment_replanned", "appointment_timers": planned}


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
            detail={"previous": state.get("previous_stage"),  # X2: delivered -> never back to Sold Pending
                            "delivered": bool(state.get("sold_delivered_at"))})], lead=lead, customer_id=event.customer_id)
    return reversed_


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
    if state.get("duplicate_of") and await duplicates.workflow_lead_id(db, event.lead_id) != event.lead_id:
        return {"status": "duplicate", "reason": f"linked to open lead {state['duplicate_of']}: not resumed"}
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
