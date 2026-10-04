"""Runs one turn end to end: graph → send → schedule → lead status → turn log.

The graph decides and drafts; this module owns everything with a side effect
on the customer (architecture §7 "The pipeline never sends"). Send is real
(channels/sender.py); Schedule saves the 24h channel switch
(scheduler/followups.py). Both are traced like every other step so the Debug
UI shows the full path.

Limits (architecture §7): the whole turn gets 8s for a new lead's first reply
and 20s otherwise. Running out of time sends the template - never nothing.

After-hours (MASTER_PLAN_3 B1, agent/after_hours.py): once the reply is out,
the choice Decide worked out is saved on the conversation state, and the
morning message (`resume_at_opening`) is scheduled or cancelled. The morning
message is itself a turn (trigger `resume_at_opening`, not a reply to the
customer): it also leaves the team a notice with the lead's details.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from upsell_agent import clock
from upsell_agent.agent import cadence, human_contact, lead_bucket, lifecycle, service_request
from upsell_agent.agent.after_hours import TRIGGER_RESUME
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import after_turn, load_conversation
from upsell_agent.agent.graph import build_graph
from upsell_agent.agent.nodes.decide import possible_opt_out
from upsell_agent.agent.nodes.template_reply import template_draft
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.summary import UPDATE_SUMMARY_JOB
from upsell_agent.agent.templates import SOLD_VEHICLE_FALLBACK_SUBJECT, SOLD_VEHICLE_FALLBACK_TEXT
from upsell_agent.agent.vehicle_media import MediaPick, photo_for_draft
from upsell_agent.channels import consent
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender, SendOutcome, SendRequest
from upsell_agent.compliance.engine import Decision, can_contact
from upsell_agent.config import Settings, get_settings
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)
from upsell_agent.integrations.platform_client import PlatformClient, StubPlatformClient
from upsell_agent.learning import touches
from upsell_agent.observability.trace import NullTraceSink, TraceSink, TurnTracer
from upsell_agent.observability.tracing import turn_trace
from upsell_agent.scheduler.followups import (
    TRIGGER_CADENCE_TOUCH,
    TRIGGER_NEXT_ACTION,
    cancel_cadence_touch,
    cancel_resume,
    cancel_visit_followup,
    plan_appointment_timers,
    plan_cadence_touch,
    plan_call_task,
    plan_followup,
    plan_handoff_check,
    plan_next_action,
    plan_resume,
    plan_visit_followup,
)
from upsell_agent.slots.requirements import lead_type_for
from upsell_agent.tools.inventory_tool import find_sold, get_inventory_source
from upsell_agent.worker.queue import Enqueue

logger = logging.getLogger(__name__)

# Kept for existing imports (events/handlers.py, devtools).
LEADS_COLLECTION = PLATFORM_LEADS_COLLECTION


def _default_sender() -> Sender:
    return Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0)


@dataclass
class TurnDeps:
    sink: TraceSink = field(default_factory=NullTraceSink)
    store_prompts: bool = False
    sender: Sender = field(default_factory=_default_sender)
    platform: PlatformClient = field(default_factory=StubPlatformClient)
    settings: Settings | None = None
    # Queues follow-up work after a turn (the rolling summary). None: not queued.
    enqueue: Enqueue | None = None

    @property
    def config(self) -> Settings:
        return self.settings or get_settings()


@lru_cache
def _graph():
    return build_graph()


def lead_type_from_lead(lead: dict | None) -> LeadType:
    """Kept for existing callers; the mapping lives in slots/requirements.py."""
    return lead_type_for(lead)


async def find_lead(db: DealerScopedDatabase, lead_id: str | None) -> dict | None:
    if not lead_id:
        return None
    return await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})


async def find_customer(db: DealerScopedDatabase, customer_id: str | None) -> dict | None:
    if not customer_id:
        return None
    return await db.collection(PLATFORM_CUSTOMERS_COLLECTION).find_one({"_id": as_object_id(customer_id)})


async def run_turn(
    *,
    dealer_id: str,
    customer_id: str,
    lead_id: str | None,
    trigger: str,
    channel: str,
    inbound_text: str,
    shadow: bool,
    deps: TurnDeps,
    event_received_at: datetime | None = None,
    source_message_id: str | None = None,
    turn_id: str | None = None,
    batch: list[dict[str, Any]] | None = None,
    is_reply: bool = True,
) -> dict[str, Any]:
    """`is_reply`: False for a message the system starts (the after-hours
    morning message), which the send check treats as outbound.

    `turn_id`: the handlers derive it from what triggered the turn, so a
    re-run of the same job (a retry, or the queue re-delivering it) reuses the
    send's idempotency key and can never message the customer twice.

    `batch`: the stored customer messages this turn answers ({id, channel,
    text, at}), listed in the trace and in the context pack one by one."""
    settings = deps.config
    db = dealer_scoped_db(dealer_id)
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id,
        trigger=trigger, channel=channel, store_prompts=deps.store_prompts, turn_id=turn_id,
    )
    batch = batch or []
    await tracer.start({"text": inbound_text, "channel": channel, "shadow": shadow,
                        **({"batch": batch} if batch else {})})

    lead = await find_lead(db, lead_id)
    customer = await find_customer(db, customer_id)
    lead_state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id}) if lead_id else None
    # MASTER_PLAN_4 A1: the lead's sales bucket (blueprint §2) - set on its first turn, moved by a clear change
    # of intent in a reply, or picked by the demo keyword (which then isn't answered as a question).
    lead_state, inbound_text = await lead_bucket.apply_to_turn(
        db, lead_id=lead_id, customer_id=customer_id, lead=lead, lead_state=lead_state, trigger=trigger,
        inbound_text=inbound_text, demo_keywords=settings.demo_bucket_keywords, source_message_id=source_message_id)
    ctx = TurnContext(
        db=db, platform=deps.platform, settings=settings, tracer=tracer, lead=lead, customer=customer,
        lead_state=lead_state, source_message_id=source_message_id or f"lead:{lead_id}",
    )
    if lead_id:
        # The reply's send check before drafting (not logged: the Sender logs
        # the real one), so a night-time reply in an outbound conversation is
        # written to ask nothing (architecture §15 decision 29).
        precheck = await can_contact(dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                     purpose="reply" if is_reply else "marketing", is_reply=is_reply, lead=lead,
                                     customer=customer,
                                     record=False)
        ctx.compliance = precheck.as_dict()
        await _save_origin(db, lead_id, precheck)
    state = AgentState(
        dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id, trigger=trigger,
        channel=channel, turn_id=tracer.turn_id, inbound_text=inbound_text, shadow=shadow,
        new_message_ids=[str(m["id"]) for m in batch],
        first_reply_via_template=(trigger == "lead_created" and settings.first_reply_mode == "template"),
        customer_name=(customer or {}).get("name") or (lead or {}).get("name"),
    )
    deadline = settings.first_reply_deadline_s if trigger == "lead_created" else settings.reply_deadline_s

    async with turn_trace(tracer.turn_id, dealer_id=dealer_id, lead_id=lead_id, trigger=trigger) as trace_id:
        tracer.log["langfuse_trace_id"] = trace_id
        try:
            async with asyncio.timeout(deadline):
                result = await _graph().ainvoke(state, config={"configurable": {"ctx": ctx}})
        except TimeoutError:
            result = await _deadline_fallback(tracer, state, deadline)
        except Exception as exc:
            log = await tracer.finish("error", {"error": repr(exc)})
            await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
            raise

        draft = result.get("draft") or {}
        decision = result.get("decision") or {}
        action = decision.get("action")
        reply = draft.get("sms_text") if channel == "sms" else draft.get("email_body")
        sent: SendOutcome | None = None
        also_sent: SendOutcome | None = None

        if action == "stop" or not draft:
            await tracer.skipped("send", "Customer opted out: nothing is sent." if action == "stop" else "No draft.")
            await tracer.skipped("schedule", "Nothing was sent.")
        elif not lead_id:
            await tracer.skipped("send", "No lead to reply on.")
            await tracer.skipped("schedule", "No lead.")
        else:
            subject = None if channel == "sms" else draft.get("email_subject")
            reply, subject, freshness = await _fresh_send_text(ctx, dealer_id, draft, channel, reply, subject)
            # MASTER_PLAN_4 F3: the named vehicle's own photo, checked, never a link in its place.
            photo = await _photo(ctx, draft, channel, decision, stock_free=bool(freshness and freshness["sold"]))
            request = SendRequest(
                dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id, turn_id=tracer.turn_id,
                channel=channel, text=reply or "", subject=subject,
                shadow=shadow, event_received_at=event_received_at, is_reply=is_reply,
                purpose="reply" if is_reply else "marketing",  # decision 136
                media_urls=photo.urls,
            )
            async with tracer.node("send", {"channel": channel, "idempotency_key": request.idempotency_key,
                                            "text": request.text, "subject": request.subject,
                                            "media_urls": request.media_urls}) as span:
                sent = await deps.sender.send(request)
                span.output = {**sent.as_dict(), "freshness_recheck": freshness, "photo": photo.as_dict()}
                span.reasoning = [*photo.reasons, *sent.reasoning]
                if freshness and freshness["sold"]:
                    span.reasoning.insert(0, f"Re-checked stock right before sending: {', '.join(freshness['sold'])} "
                                             "sold in the meantime, so the stock-free version was sent instead.")
                span.metrics = {"attempts": sent.attempts, "event_to_send_ms": sent.latency_ms}
                span.edge_label = sent.status
            # MASTER_PLAN_3 C4 (Omnichannel PDF p.10): a cadence touch goes out on text AND email
            # together, not one channel now and the other in 24 hours.
            also_sent = await _send_other_channel(
                tracer, deps, draft=draft, trigger=trigger, dealer_id=dealer_id, lead_id=lead_id,
                customer_id=customer_id, channel=channel, shadow=shadow, event_received_at=event_received_at,
                ctx=ctx, decision=decision)
            async with tracer.node("schedule", {"sent_status": sent.status, "channel": channel}) as span:
                planned = await _plan_next_contact(
                    db, sent=sent, draft=draft, lead=lead, customer=customer, lead_id=lead_id,
                    customer_id=customer_id, turn_id=tracer.turn_id, channel=channel, action=action,
                    lead_state=lead_state, shadow=shadow, trigger=trigger,
                    hold_cadence=_hold_cadence(decision))
                span.output = planned
                if planned.get("cadence"):
                    span.reasoning = [planned["reason"]]
                    span.edge_label = (f"touch {(planned.get('plan') or {}).get('touch_number')}"
                                       if planned["created"] else "no next touch")
                elif planned["created"]:
                    when = "now (the send failed)" if planned["due_now"] else "in 24h if there's no reply"
                    if planned["held_to_contact_window"]:
                        when = (f"at {_dealer_time(planned['due_at'], planned['timezone'])} "
                                f"(held by the send check: {planned['held_reason']})")
                    span.reasoning = [f"Same message goes to {planned['to_channel']} ({planned['to']}) {when}."]
                    if planned["superseded"]:
                        span.reasoning.append("Replaced this lead's older pending follow-up.")
                    span.edge_label = f"→ {planned['to_channel']} {'now' if planned['due_now'] else 'later'}"
                else:
                    span.reasoning = [f"No follow-up: {planned['reason']}."]
                if _hands_off(result) and not shadow:
                    check = await plan_handoff_check(
                        db, lead_id=lead_id, customer_id=customer_id, channel=channel, handoff_id=tracer.turn_id,
                        handoff_reason=_handoff_reason(result))
                    span.output = {**planned, "handoff_check": check}
                    span.reasoning.append(
                        f"Staff check at {_dealer_time(check['due_at'], check['timezone'])}: "
                        f"{check['business_minutes']} business minutes ({check['timezone']}"
                        + ("" if check["hours_from_record"] else ", default hours") + "). If nobody has taken "
                        "the lead over by then, the customer gets one more holding reply and staff get an alert.")
                    span.edge_label = "staff check"
                    # PLAN_4 stream H: the customer chose a call or a text from a person - staff get the call
                    # task (now, or at the next calling time) or the "wants a text" notice.
                    person = await human_contact.act_after_send(
                        db, decision, lead_id=lead_id, customer_id=customer_id,
                        customer_name=(customer or {}).get("name") or (lead or {}).get("name"),
                        turn_id=tracer.turn_id)
                    if person:
                        span.output = {**(span.output or {}), "human_contact": person}
                        span.reasoning.append(f"Speak to a person ({person['mode']}): {person['reason']}.")
                after_hours = await _after_hours_followup(db, decision, sent, lead_id=lead_id, lead=lead,
                                                          customer=customer, customer_id=customer_id,
                                                          channel=channel, turn_id=tracer.turn_id, shadow=shadow)
                if after_hours:
                    span.output = {**(span.output or {}), "after_hours": after_hours}
                    span.reasoning.append(after_hours["reason"])
                    if after_hours.get("created"):
                        span.edge_label = "morning message"
                visit_followup = await _visit_followup_schedule(
                    db, decision, sent, lead_id=lead_id, lead=lead, customer=customer, customer_id=customer_id,
                    channel=channel, turn_id=tracer.turn_id, shadow=shadow)
                if visit_followup:
                    span.output = {**(span.output or {}), "visit_followup": visit_followup}
                    if visit_followup.get("reason"):
                        span.reasoning.append(visit_followup["reason"])
                    if visit_followup.get("created"):
                        span.edge_label = "visit follow-up"

        await _update_lead_state(db, lead_id, trigger, sent, result, lead_state=lead_state, channel=channel,
                                 shadow=shadow, turn_id=tracer.turn_id)
        # PLAN_4 stream L: new/used (current and original, agent/lead_bucket.py), then the touch this turn sent,
        # if it was one (learning/touches.py: the first reply, a cadence touch, a dated step...).
        lead_state = await lead_bucket.track_vehicle_type(db, lead_id=lead_id, lead=lead, lead_state=lead_state,
                                                          profile=result.get("profile"))
        if (kind := touches.touch_kind(trigger)) and not shadow:
            await touches.record_touch(
                db, touch_id=tracer.turn_id, lead_id=lead_id, customer_id=customer_id, kind=kind,
                outcomes=[sent, also_sent], lead=lead, lead_state=lead_state,
                touch=(lead_state or {}).get("pending_touch") if trigger == TRIGGER_CADENCE_TOUCH else None,
                theme_label="Touch 1" if kind == touches.KIND_FIRST_REPLY else None)
        stage_change = await _lifecycle_after_turn(db, lead_id, trigger, sent, result, inbound_text=inbound_text,
                                                   lead=lead, customer=customer, customer_id=customer_id,
                                                   channel=channel, turn_id=tracer.turn_id, shadow=shadow,
                                                   hold_cadence=_hold_cadence(decision))
        if trigger == TRIGGER_RESUME and sent is not None and sent.status in ("sent", "duplicate") and not shadow:
            await _notify_team_at_opening(db, lead_id, result)
        if sent is not None and sent.status in ("sent", "duplicate") and not shadow:
            await _notify_team_of_booking(db, lead_id, decision)
            # MASTER_PLAN_4 F2: a service visit is requested, not booked - the team gets the request and notes.
            await service_request.notify_team(db, deps.platform, dealer_id=dealer_id, lead_id=lead_id,
                                              customer_id=customer_id, decision=decision, turn_id=tracer.turn_id)
            await _note_not_interested(db, deps.platform, lead_id, customer_id, decision, tracer.turn_id)  # stream R
        review = await _open_review_if_possible_opt_out(db, lead_id, customer_id, result, inbound_text, channel)

        if result.get("used_template") and not result.get("used_fallback"):
            outcome = "template_reply"
        elif result.get("used_fallback"):
            outcome = "fallback"
        else:
            outcome = action or "unknown"
        summary_queued = await _queue_summary(deps, result, dealer_id, lead_id, tracer.turn_id)
        calls = ctx.model_calls
        log = await tracer.finish(outcome, {
            "action": action, "reply": reply, "used_fallback": result.get("used_fallback", False),
            "fallback_reason": result.get("fallback_reason"), "flag_human": result.get("flag_human", False),
            "retries": result.get("retry_count", 0),
            "send_status": sent.status if sent else None,
            "event_to_send_ms": sent.latency_ms if sent else None,
            "asked": decision.get("slots", []),
            "required": {"filled": decision.get("required_filled"), "total": decision.get("required_total")},
            "ai_calls": ctx.ai_calls,
            "tokens_in": sum(c.get("tokens_in") or 0 for c in calls),
            # Stream G: the part of tokens_in served from OpenAI's prompt cache (billed at the cached price).
            "tokens_cached": sum(c.get("tokens_cached") or 0 for c in calls),
            "tokens_out": sum(c.get("tokens_out") or 0 for c in calls),
            "cost_usd": round(sum(c.get("cost_usd") or 0 for c in calls), 6),
            "campaign_id": (result.get("campaign") or {}).get("campaign_id"),
            "batched": len(batch),
            "summary_queued": summary_queued,
            "send_check": (sent.compliance or {}).get("outcome") if sent else None,
            "origin": (ctx.compliance or {}).get("origin", {}).get("origin"),
            "review_opened": review,
            "after_hours": (decision.get("after_hours") or {}).get("mode"),
            # MASTER_PLAN_3 C4: the other channel this touch also went out on (Omnichannel PDF p.10).
            "also_sent": {"channel": also_sent.channel, "status": also_sent.status} if also_sent else None,
            "touch": (lead_state or {}).get("pending_touch") if trigger == TRIGGER_CADENCE_TOUCH else None,
            # MASTER_PLAN_3 C3: where the lead now stands, and whether this turn moved it.
            "stage": (stage_change or {}).get("stage"),
            "stage_change": stage_change if (stage_change or {}).get("changed") else None,
            # MASTER_PLAN_3 B4 item 7: for the visit offer / booking rates.
            "visit_offer_attempt": (decision.get("visit_offer") or {}).get("attempt"),
            "booked": bool((decision.get("visit") or {}).get("just_booked")
                           and not (decision.get("visit") or {}).get("moved_this_turn")),
        })
        await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
        return log


async def _after_hours_followup(db: DealerScopedDatabase, decision: dict[str, Any], sent: SendOutcome | None, *,
                                lead_id: str, lead: dict | None, customer: dict | None, customer_id: str,
                                channel: str, turn_id: str, shadow: bool) -> dict[str, Any] | None:
    """The after-hours plan's follow-up (MASTER_PLAN_3 B1): after "later" the
    morning message is scheduled; after "now" (or a visit request, or the
    dealer opening) a pending one is cancelled. Only when the reply went out."""
    plan = decision.get("after_hours") or {}
    if shadow or sent is None or sent.status not in ("sent", "failed", "duplicate"):
        return None
    if plan.get("schedule_resume"):
        return await plan_resume(db, lead_id=lead_id, customer_id=customer_id, channel=channel, turn_id=turn_id,
                                 lead=lead, customer=customer)
    if plan.get("cancel_resume"):
        cancelled = await cancel_resume(db, lead_id, reason=plan.get("why") or "the conversation carried on")
        return {"created": False, "cancelled": cancelled,
                "reason": f"Morning message cancelled: {plan.get('why')}" if cancelled
                else "No morning message was pending."}
    return None


#: Turns whose message the client requires on every permitted channel at once (Omnichannel PDF p.10).
#: The staff call task (C2) is a separate timer behind these, so that means text + email together. The dated
#: check-back of Contact Made - Specific Follow-Up is one too (p.10 "Applies Everywhere Follow-Up Occurs").
OMNICHANNEL_TRIGGERS = frozenset({TRIGGER_CADENCE_TOUCH, TRIGGER_NEXT_ACTION})
#: Turns whose sent message starts the 60-minute connection timer behind a staff call task (MASTER_PLAN_3 C2):
#: Touch 1, every cadence touch and the specific follow-up's check-back (Global Human Call Task Escalation
#: Rule, "Where This Rule Applies"), not a reply to something the customer just wrote.
CALL_TASK_TRIGGERS = frozenset({"lead_created", TRIGGER_CADENCE_TOUCH, TRIGGER_NEXT_ACTION})


def _hold_cadence(decision: dict[str, Any]) -> str | None:
    """Why no cadence touch is planned this turn: the customer chose to wait for the team (B1), so its
    morning message comes first and no touch lands at opening on top of it."""
    if (decision.get("after_hours") or {}).get("schedule_resume"):
        return "the customer chose to wait for the team: its morning message comes first"
    return None


async def _send_other_channel(tracer: TurnTracer, deps: TurnDeps, *, draft: dict[str, Any], trigger: str,
                              dealer_id: str, lead_id: str, customer_id: str, channel: str, shadow: bool,
                              event_received_at: datetime | None, ctx: TurnContext | None = None,
                              decision: dict[str, Any] | None = None) -> SendOutcome | None:
    """The same touch on the other channel (MASTER_PLAN_3 C4). The send check
    runs again for it, so one channel being opted out, suppressed or outside
    its window never stops the other (Omnichannel PDF p.10, "continue every
    remaining permitted channel"). The idempotency key carries the channel, so
    a re-run can't send either message twice."""
    if trigger not in OMNICHANNEL_TRIGGERS:
        return None
    other = "email" if channel == "sms" else "sms"
    text = draft.get("sms_text") if other == "sms" else draft.get("email_body")
    if not text:
        await tracer.skipped(f"send_{other}", f"The draft has no {other} version.")
        return None
    photo = await _photo(ctx, draft, other, decision or {}) if ctx is not None else None
    request = SendRequest(
        dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id, turn_id=tracer.turn_id, channel=other,
        text=text, subject=None if other == "sms" else draft.get("email_subject"), shadow=shadow,
        event_received_at=event_received_at, is_reply=False, purpose="marketing",
        media_urls=photo.urls if photo else [],
    )
    async with tracer.node(f"send_{other}", {"channel": other, "idempotency_key": request.idempotency_key,
                                             "text": request.text, "subject": request.subject,
                                             "media_urls": request.media_urls}) as span:
        outcome = await deps.sender.send(request)
        span.output = {**outcome.as_dict(), **({"photo": photo.as_dict()} if photo else {})}
        span.reasoning = ["Every follow-up goes out on text and email together.",
                          *(photo.reasons if photo else []), *outcome.reasoning]
        span.metrics = {"attempts": outcome.attempts}
        span.edge_label = f"{other}: {outcome.status}"
    return outcome


async def _plan_next_contact(db: DealerScopedDatabase, *, sent: SendOutcome, draft: dict[str, Any],
                             lead: dict | None, customer: dict | None, lead_id: str, customer_id: str,
                             turn_id: str, channel: str, action: str | None, lead_state: dict | None,
                             shadow: bool, trigger: str, hold_cadence: str | None = None) -> dict[str, Any]:
    """What happens next if the customer doesn't answer. Once a lead's cadence
    is running (MASTER_PLAN_3 C4) that's the next cadence touch, which goes to
    both channels; Plan 1's one-channel 24h switch is what it replaces
    (decision 147). A lead with no cadence - one from before C4, or a dealer
    whose cadence never started - keeps the old switch."""
    if shadow:
        return {"created": False, "reason": "shadow mode: nothing is scheduled"}
    state = cadence.CadenceState.load(lead_state)
    if state.started_at is None:
        return await plan_followup(db, sent=sent, draft=draft, lead=lead, customer=customer, lead_id=lead_id,
                                   customer_id=customer_id, turn_id=turn_id, channel=channel, action=action)
    if trigger == "inbound_message" and state.touch_number <= 2:
        # The customer wrote back: no name nudge for someone who has answered (agent/cadence.py).
        state = cadence.after_reply(state)
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": lead_id}, {"$set": {"cadence": state.as_dict()}})
        lead_state = {**(lead_state or {}), "cadence": state.as_dict()}
    if trigger == TRIGGER_CADENCE_TOUCH:
        # This turn WAS a touch: it used up its theme, so the next one moves on (agent/cadence.py).
        pending = (lead_state or {}).get("pending_touch") or {}
        planned_touch = cadence.PlannedTouch(
            touch_number=int(pending.get("touch_number") or state.touch_number), day=int(pending.get("day") or 0),
            theme=cadence.BY_ID.get(pending.get("theme") or ""))
        state = cadence.after_touch(state, planned_touch, at=clock.now())
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
            {"lead_id": lead_id}, {"$set": {"cadence": state.as_dict()}, "$unset": {"pending_touch": ""}})
        # The next touch is planned from the state this touch just left, not the one the turn started with.
        lead_state = {**(lead_state or {}), "cadence": state.as_dict()}
    if hold_cadence:
        # The customer chose to wait for the team (B1): the morning message comes first, so no touch
        # lands at opening on top of it. It's planned again once that message has gone out.
        await cancel_cadence_touch(db, lead_id, reason=hold_cadence)
        return {"cadence": True, "created": False, "reason": f"No cadence touch yet: {hold_cadence}."}
    if action == "handoff":
        await cancel_cadence_touch(db, lead_id, reason="the lead is with a person now")
        return {"cadence": True, "created": False,
                "reason": "No cadence touch: the lead has been handed to a person."}
    if sent.status not in ("sent", "failed", "duplicate"):
        return {"cadence": True, "created": False, "reason": f"No cadence touch: message not sent ({sent.status})."}
    fallback = None
    if trigger not in OMNICHANNEL_TRIGGERS:
        # A single-channel message (Touch 1, a reply): a send that failed falls back to the other channel
        # now; a delivery failure the provider reports later does the same through the dormant `standby`
        # copy (decision 154). The cadence's own touches already go out on both channels.
        fallback = await plan_followup(db, sent=sent, draft=draft, lead=lead, customer=customer, lead_id=lead_id,
                                       customer_id=customer_id, turn_id=turn_id, channel=channel, action=action,
                                       standby=sent.status != "failed")
    planned = await plan_cadence_touch(db, lead_id=lead_id, customer_id=customer_id, channel=channel,
                                       turn_id=turn_id, lead=lead, customer=customer, lead_state=lead_state,
                                       first_contact_done=True)
    call_task = None
    if trigger in CALL_TASK_TRIGGERS and sent.status in ("sent", "duplicate"):
        call_task = await plan_call_task(db, lead_id=lead_id, customer_id=customer_id, turn_id=turn_id, lead=lead,
                                         customer=customer, lead_state=lead_state, sent_channels=[channel])
    return {"cadence": True, "fallback": fallback, "call_task": call_task, **planned}


async def _lifecycle_after_turn(db: DealerScopedDatabase, lead_id: str | None, trigger: str,
                                sent: SendOutcome | None, result: dict[str, Any], *, inbound_text: str,
                                lead: dict | None, customer: dict | None, customer_id: str, channel: str,
                                turn_id: str, shadow: bool, hold_cadence: str | None = None) -> dict[str, Any] | None:
    """MASTER_PLAN_3 C3: what this turn means for the lead's stage
    (agent/lifecycle.py's response router, Omnichannel PDF §5): a meaningful
    customer reply (with or without a dated next step), a booking made or
    moved, or one cancelled. A dated next step also gets its scheduled
    check-back (`next_action`). Shadow turns change nothing."""
    if shadow or not lead_id:
        return None
    decision = result.get("decision") or {}
    visit = decision.get("visit") or {}
    dated = decision.get("next_action")
    events: list[lifecycle.Event] = []
    if trigger == "inbound_message":
        meaningful, why = lifecycle.is_meaningful_reply(inbound_text)
        if meaningful:
            events.append(lifecycle.Event("customer_replied", reason=f"The customer replied: {why}",
                                          detail={"next_action": dated}))
    if visit.get("just_booked"):
        events.append(lifecycle.Event("appointment_set", reason=(
            f"Appointment {'moved to' if visit.get('moved_this_turn') else 'booked for'} {visit.get('display')}"),
            detail={"appointment": {"display": visit.get("display"), "booking_id": visit.get("booking_id"),
                                    "status": visit.get("status"), "by": "ai"}}))
    elif visit.get("cancelled_this_turn"):
        events.append(lifecycle.Event("appointment_cancelled", reason="The customer cancelled their appointment",
                                      detail={"next_action": dated}))
    if (trigger == TRIGGER_CADENCE_TOUCH and sent is not None and sent.status in ("sent", "duplicate")
            and ((decision.get("touch") or {}).get("theme") == cadence.NAME_NUDGE.id)):
        # Touch 1 and the 3-hour nudge have both gone out with no word back: No Contact Made
        # (decision 124; Omnichannel PDF §1).
        events.append(lifecycle.Event("touch2_unanswered", source="cadence",
                                      reason="Touch 1 and the 3-hour name nudge went unanswered"))
    if not events:
        return None
    change = await lifecycle.apply(db, lead_id, events, lead=lead, customer_id=customer_id)
    if (change and change.get("cadence_started") and not hold_cadence and sent is not None
            and sent.status in ("sent", "failed", "duplicate")):
        # The lead entered a Short-Term stage from outside it (a re-entry after a dated step went unanswered,
        # an Unsold visit...): a fresh cadence starts, and its first touch is planned now.
        change["cadence_touch"] = await plan_cadence_touch(
            db, lead_id=lead_id, customer_id=customer_id, channel=channel, turn_id=turn_id, lead=lead,
            customer=customer, first_contact_done=True)
    if change and change.get("stage") == lifecycle.Stage.APPOINTMENT_SET and any(
            e.kind == "appointment_set" for e in events):
        # An appointment was set or moved (MASTER_PLAN_3 C5): its countdown, day-before confirmation and
        # +1h no-show check are planned from the appointment itself, replacing any older ones.
        change["appointment_timers"] = await plan_appointment_timers(
            db, lead_id=lead_id, customer_id=customer_id, lead=lead, customer=customer, channel=channel,
            turn_id=turn_id)
    if change and change.get("stage") == lifecycle.Stage.SPECIFIC_FOLLOWUP and dated:
        change["next_action_scheduled"] = await plan_next_action(
            db, lead_id=lead_id, customer_id=customer_id, channel=dated.get("channel") or channel, turn_id=turn_id,
            next_action=dated, lead=lead, customer=customer)
    if change and change.get("stage") == lifecycle.Stage.CLOSED_LOST and trigger == "inbound_message":
        # The customer wrote on a closed lead: answered (never silent), and the team is told - only a person
        # reopens it, or a new lead starts its own workflow (client, 1 Oct 2026).
        await db.collection(AI_LEAD_STATE_COLLECTION).update_one({"lead_id": lead_id}, {"$set": {"staff_notice": {
            "at": clock.now(), "kind": "reply_on_closed_lead",
            "text": f"The customer wrote on a Closed - Lost lead: {inbound_text[:200]!r}. Reopen it or start a "
                    "new lead if they're back in the market."}}})
    return change


async def _visit_followup_schedule(db: DealerScopedDatabase, decision: dict[str, Any], sent: SendOutcome | None, *,
                                   lead_id: str, lead: dict | None, customer: dict | None, customer_id: str,
                                   channel: str, turn_id: str, shadow: bool) -> dict[str, Any] | None:
    """The dated visit follow-up after a 3rd decline (MASTER_PLAN_3 B4 item
    4): scheduled once the decline reply goes out; cancelled once a booking
    exists (nothing left to follow up on). Only when the reply went out.
    A decline that named its own date ("maybe next month") is a dated next
    step instead (MASTER_PLAN_3 C3): `next_action` covers it, not this."""
    plan = decision.get("visit_plan") or {}
    if shadow or sent is None or sent.status not in ("sent", "failed", "duplicate"):
        return None
    if decision.get("next_action"):
        return None
    if plan.get("schedule_followup") and plan.get("followup_due"):
        planned = await plan_visit_followup(db, lead_id=lead_id, customer_id=customer_id, channel=channel,
                                            turn_id=turn_id, due_date=plan["followup_due"], lead=lead,
                                            customer=customer)
        return {**planned, "reason": planned.get("reason") or f"No visit follow-up: {planned.get('reason', '')}"}
    if (decision.get("visit") or {}).get("just_booked"):
        cancelled = await cancel_visit_followup(db, lead_id, reason="a booking was made")
        return {"created": False, "reason": "Visit follow-up cancelled: a booking was made."} if cancelled else None
    return None


async def _note_not_interested(db: DealerScopedDatabase, platform: Any, lead_id: str | None, customer_id: str | None,
                               decision: dict[str, Any], turn_id: str) -> None:
    """MASTER_PLAN_4 (stream R): the customer is no longer interested and the lead goes to a person - the reason, in
    their own words, as a staff note in the CRM conversation (agent/crm_notes.py)."""
    info = decision.get("not_interested") or {}
    if not lead_id or info.get("mode") != "handoff":
        return
    from upsell_agent.agent import crm_notes
    reason = info.get("reason")
    text = (f"The customer says they're no longer interested. Their reason: {reason!r}." if reason else
            "The customer says they're no longer interested and gave no reason after being asked.")
    await crm_notes.write(db, lead_id=lead_id, kind="not_interested", platform=platform, customer_id=customer_id,
                          key=f"{turn_id}:not_interested",
                          text=text + " The AI has stopped following up; a person decides whether to close the lead.")


async def _notify_team_of_booking(db: DealerScopedDatabase, lead_id: str, decision: dict[str, Any]) -> None:
    """The team is told of every booking, move or cancel (B5 item 6), with
    the known-gap notes (architecture §15 decisions 58-59: old reminders and
    the lead's status may need a manual check until C5)."""
    visit = decision.get("visit") or {}
    if visit.get("just_booked"):
        kind = "visit_moved" if visit.get("moved_this_turn") else "visit_booked"
        text = (f"Visit {'moved to' if visit.get('moved_this_turn') else 'booked for'} {visit.get('display')} "
                f"({visit.get('status')}).")
        if visit.get("moved_this_turn"):
            text += " Known gap: the platform doesn't cancel the old reminders on a move - please clear them."
    elif visit.get("cancelled_this_turn"):
        kind, text = "visit_cancelled", ("The customer cancelled their visit. Known gaps: the platform doesn't "
                                         "cancel reminders on a cancel, and the lead's status still needs updating "
                                         "by hand (both until C5).")
    else:
        return
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id}, {"$set": {"staff_notice": {"at": clock.now(), "kind": kind, "text": text}}})


async def _notify_team_at_opening(db: DealerScopedDatabase, lead_id: str, result: dict[str, Any]) -> None:
    """The team's notice when the morning message goes out (MASTER_PLAN_3 B1,
    decision 57): a notification only, the AI stays in charge. Saved on the
    AI's lead state (shown in the Debug UI); the platform doesn't show it yet."""
    pack = result.get("context_pack") or {}
    known = [f"{k['label']}: {k['value']}" for k in (pack.get("about_customer") or {}).get("known", [])]
    open_questions = [q["text"] for q in (pack.get("conversation") or {}).get("open_questions", [])]
    decision = result.get("decision") or {}
    text = ("After-hours lead: the customer asked for the team to pick this up at opening, and the AI has just "
            f"messaged them. {decision.get('required_filled')} of {decision.get('required_total')} required "
            "details collected" + (f" ({'; '.join(known)})" if known else "") + "."
            + (f" Still open: {'; '.join(open_questions)}." if open_questions else ""))
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": {"staff_notice": {"at": clock.now(), "kind": "after_hours_resume", "text": text}}})


async def _save_origin(db: DealerScopedDatabase, lead_id: str, check: Decision) -> None:
    """Inbound or outbound and the customer's time zone, on the lead
    (MASTER_PLAN_3 B2 item 4, B0.5), with how each was found."""
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": {"origin": check.origin, **({"customer_zone": check.zone} if check.zone else {})},
         "$setOnInsert": {"lead_id": lead_id, "created_at": clock.now(), "status": "active"}},
        upsert=True)


async def _open_review_if_possible_opt_out(db: DealerScopedDatabase, lead_id: str | None, customer_id: str,
                                           result: dict[str, Any], text: str, channel: str) -> bool:
    """Extract flagged a possible opt-out (C1 item 3, decision 72): marketing
    stops until the customer writes again with something that isn't one, or
    an admin resumes the AI. Staff get a notice quoting the message."""
    extraction = result.get("extraction") or {}
    if not lead_id or not possible_opt_out(extraction):
        return False
    now = clock.now()
    await consent.record_consent(
        db, customer_id=customer_id, channel="all", consent_type="review", status="open",
        source="possible_opt_out", lead_id=lead_id,
        evidence={"message": text, "channel": channel, "confidence": extraction.get("opt_out_confidence")})
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": {"compliance_review": {"at": now, "message": text, "channel": channel,
                                        "confidence": extraction.get("opt_out_confidence")},
                  "staff_notice": {"at": now, "kind": "possible_opt_out",
                                   "text": f"Possible opt-out, please review: {text!r}. Marketing is stopped "
                                           "until the customer writes again or the AI is resumed; set the "
                                           "lead to DND if it was an opt-out."}}})
    return True


async def _queue_summary(deps: TurnDeps, result: dict[str, Any], dealer_id: str, lead_id: str | None,
                         turn_id: str) -> bool:
    """After the send: when messages have left working memory and the summary
    doesn't cover them yet, queue its update (agent/summary.py)."""
    budget = (result.get("context_pack") or {}).get("budget") or {}
    if not (lead_id and deps.enqueue and budget.get("summary_behind")):
        return False
    try:
        await deps.enqueue(UPDATE_SUMMARY_JOB, key=f"{UPDATE_SUMMARY_JOB}:{lead_id}:{turn_id}",
                           dealer_id=dealer_id, lead_id=lead_id)
    except Exception:
        logger.exception("could not queue the summary update for lead %s", lead_id)
        return False
    return True


async def _deadline_fallback(tracer: TurnTracer, state: AgentState, deadline: float) -> dict[str, Any]:
    """The turn ran out of time mid-graph: build the template reply here and
    trace it as the fallback step, so the customer still gets an answer."""
    reason = f"the turn ran past its {deadline:g}s limit"
    async with tracer.node("fallback", {"reason": reason, "lead_type": state.lead_type}) as span:
        lead_type = lead_type_for(await find_lead(dealer_scoped_db(state.dealer_id), state.lead_id))
        draft = template_draft(lead_type, state.customer_name, f"Template used because {reason}.")
        span.output = draft
        span.reasoning = [f"Out of time: {reason}. Sending the '{lead_type.value}' template instead."]
        span.edge_label = "fallback template"
    return {"draft": draft, "used_template": True, "used_fallback": True, "fallback_reason": reason}


def _dealer_time(iso: str, timezone: str) -> str:
    """A due time as the dealer reads it, e.g. "Tue 10:30 EDT"."""
    return datetime.fromisoformat(iso).astimezone(ZoneInfo(timezone)).strftime("%a %H:%M %Z")


async def _fresh_send_text(ctx: TurnContext, dealer_id: str, draft: dict[str, Any], channel: str,
                           reply: str | None, subject: str | None) -> tuple[str | None, str | None, dict[str, Any] | None]:
    """MASTER_PLAN_3 Phase 5 item 1: if this turn named a vehicle, re-check it
    right before sending (writing the reply, the guard, and a possible rewrite
    all take time). One sold in the meantime means sending the stock-free
    version Compose already wrote alongside it (decision L), not a bare
    fallback and not another AI call. `None` (no vins named) skips the check
    entirely - the common case, and free."""
    vins = list((draft.get("sms_vins") if channel == "sms" else draft.get("email_vins")) or [])
    if not vins:
        return reply, subject, None
    source = ctx.inventory or get_inventory_source(ctx.settings)
    sold = await find_sold(dealer_id, vins, source)
    info = {"checked": vins, "sold": sold}
    if not sold:
        return reply, subject, info
    no_vehicle_reply = draft.get("sms_text_no_vehicles") if channel == "sms" else draft.get("email_body_no_vehicles")
    no_vehicle_subject = None if channel == "sms" else draft.get("email_subject_no_vehicles")
    # Never fall back to `reply` here: it's the version that names the sold
    # vehicle. A missing stock-free version (Compose didn't write one despite
    # the instruction to) gets the generic fallback instead, never the original.
    if no_vehicle_reply:
        return no_vehicle_reply, no_vehicle_subject or subject, info
    return SOLD_VEHICLE_FALLBACK_TEXT, (None if channel == "sms" else SOLD_VEHICLE_FALLBACK_SUBJECT), info


async def _photo(ctx: TurnContext, draft: dict[str, Any], channel: str, decision: dict[str, Any], *,
                 stock_free: bool = False) -> MediaPick:
    """MASTER_PLAN_4 F3 (agent/vehicle_media.py): the photo for this channel's version of the draft."""
    return await photo_for_draft(
        ctx.db.dealer_id, draft, channel, settings=ctx.settings, source=ctx.inventory,
        theme=(decision.get("touch") or {}).get("theme"), lead=ctx.lead, lead_state=ctx.lead_state,
        stock_free=stock_free)


def _hands_off(result: dict[str, Any]) -> bool:
    return bool(result.get("flag_human")) or (result.get("decision") or {}).get("action") == "handoff"


def _handoff_reason(result: dict[str, Any]) -> str:
    if result.get("flag_human"):
        return "AI couldn't write a safe reply"
    decision = result.get("decision") or {}
    return next((r["why"] for r in decision.get("rules", []) if r["result"] == "fired"), "Customer asked for a person")


def _asked_slots(result: dict[str, Any], channel: str) -> list[str]:
    """What the reply that went out asked for: a template's own question, or
    the slots Decide chose to ask about or confirm."""
    draft = result.get("draft") or {}
    if result.get("used_template"):
        return list((draft.get("asks") or {}).get(channel, []))
    decision = result.get("decision") or {}
    return list(decision.get("slots", [])) if decision.get("action") in ("ask", "confirm", "answer") else []


def _after_hours_record(result: dict[str, Any]) -> dict | None:
    """The after-hours choice as this turn leaves it. An offer only counts when
    the AI-written reply (which carries it) went out, not a template."""
    plan = (result.get("decision") or {}).get("after_hours") or {}
    if plan.get("mode") == "offer" and result.get("used_template"):
        return None
    return plan.get("record")


def _human_contact_record(result: dict[str, Any]) -> dict | None:
    """PLAN_4 stream H: the call-or-text state as this turn leaves it. An offer only counts when the AI-written
    reply (which carries the question) went out, not a template - the same rule as _after_hours_record."""
    plan = (result.get("decision") or {}).get("human_contact") or {}
    if plan.get("mode") == human_contact.OFFER and result.get("used_template"):
        return None
    return plan.get("record")


def _visit_record(result: dict[str, Any]) -> dict | None:
    """The visit-offer state as this turn leaves it (MASTER_PLAN_3 B4/B5). An
    offer only counts when the AI-written reply (which carries it) went out,
    not a template - the same rule as _after_hours_record."""
    plan = (result.get("decision") or {}).get("visit_plan") or {}
    if plan.get("fire") and result.get("used_template"):
        return None
    return plan.get("record")


async def _update_lead_state(db: DealerScopedDatabase, lead_id: str | None, trigger: str,
                             sent: SendOutcome | None, result: dict[str, Any], *, lead_state: dict | None,
                             channel: str, shadow: bool, turn_id: str) -> None:
    """Lead status follows the turn (architecture §8.3): qualified when
    nothing is missing, handed off when the customer asked for a person or
    the AI couldn't write a safe reply. The conversation state
    (agent/conversation.py) is updated from what actually went out."""
    if not lead_id:
        return
    decision = result.get("decision") or {}
    draft = result.get("draft") or {}
    conversation = after_turn(
        load_conversation(lead_state),
        now=clock.now(),
        send_status=sent.status if sent else None,
        shadow=shadow,
        action=decision.get("action"),
        asked_slots=_asked_slots(result, channel),
        answered=list(draft.get("answered_questions") or []),
        new_questions=list((result.get("extraction") or {}).get("questions") or []),
        used_template=bool(result.get("used_template")),
        promises=list(draft.get("promises") or []),
        after_hours=_after_hours_record(result),
        visit=_visit_record(result),
        shown_vins=list((draft.get("sms_vins") if channel == "sms" else draft.get("email_vins")) or []),
        channel=channel,
        not_interested_reason=(decision.get("not_interested") or {}).get("reason"),
        human_contact=_human_contact_record(result),
    )
    fields: dict[str, Any] = {"conversation": conversation.model_dump(mode="json"), "last_turn_at": clock.now()}
    if sent is not None:
        fields["last_send_status"] = sent.status
        if sent.status == "sent":
            fields["last_outbound_at"] = clock.now()
            if trigger == "lead_created" and sent.latency_ms is not None:
                fields["first_reply_ms"] = sent.latency_ms
    if decision.get("required_total") is not None:
        fields["required"] = {"filled": decision.get("required_filled"), "total": decision.get("required_total")}
    if _hands_off(result):
        # handoff_id ties this handoff to its staff check (scheduler/followups.py).
        fields.update(status="handoff", status_reason=_handoff_reason(result), status_at=clock.now(),
                      handoff_id=turn_id, staff_alert=None)
        if sent is not None and sent.status == "sent":
            # The handoff reply counts as the first "passed to the team" notice.
            fields["last_handoff_notice_at"] = clock.now()
    elif decision.get("action") == "qualified":
        fields.update(status="qualified", status_reason="All required details collected", status_at=clock.now())
    elif decision.get("action") == "partly_qualified":
        why = next((r["why"] for r in decision.get("rules", []) if r["result"] == "fired"), "")
        fields.update(status="partly_qualified", status_reason=f"Passed to the team with what we have. {why}",
                      status_at=clock.now())
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": fields, "$setOnInsert": {"lead_id": lead_id, "created_at": clock.now(),
                                          **({} if "status" in fields else {"status": "active"})}},
        upsert=True)
