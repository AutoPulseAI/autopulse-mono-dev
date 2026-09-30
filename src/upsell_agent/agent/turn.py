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
from upsell_agent.agent.after_hours import TRIGGER_RESUME
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import after_turn, load_conversation
from upsell_agent.agent.graph import build_graph
from upsell_agent.agent.nodes.decide import possible_opt_out
from upsell_agent.agent.nodes.template_reply import template_draft
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.summary import UPDATE_SUMMARY_JOB
from upsell_agent.channels import consent
from upsell_agent.agent.templates import SOLD_VEHICLE_FALLBACK_SUBJECT, SOLD_VEHICLE_FALLBACK_TEXT
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
from upsell_agent.observability.trace import NullTraceSink, TraceSink, TurnTracer
from upsell_agent.observability.tracing import turn_trace
from upsell_agent.scheduler.followups import (
    cancel_resume,
    cancel_visit_followup,
    plan_followup,
    plan_handoff_check,
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
    ctx = TurnContext(
        db=db, platform=deps.platform, settings=settings, tracer=tracer, lead=lead, customer=customer,
        lead_state=lead_state, source_message_id=source_message_id or f"lead:{lead_id}",
    )
    if lead_id:
        # The reply's send check before drafting (not logged: the Sender logs
        # the real one), so a night-time reply in an outbound conversation is
        # written to ask nothing (architecture §15 decision 29).
        precheck = await can_contact(dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                     purpose="marketing", is_reply=is_reply, lead=lead, customer=customer,
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

        if action == "stop" or not draft:
            await tracer.skipped("send", "Customer opted out: nothing is sent." if action == "stop" else "No draft.")
            await tracer.skipped("schedule", "Nothing was sent.")
        elif not lead_id:
            await tracer.skipped("send", "No lead to reply on.")
            await tracer.skipped("schedule", "No lead.")
        else:
            subject = None if channel == "sms" else draft.get("email_subject")
            reply, subject, freshness = await _fresh_send_text(ctx, dealer_id, draft, channel, reply, subject)
            request = SendRequest(
                dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id, turn_id=tracer.turn_id,
                channel=channel, text=reply or "", subject=subject,
                shadow=shadow, event_received_at=event_received_at, is_reply=is_reply,
            )
            async with tracer.node("send", {"channel": channel, "idempotency_key": request.idempotency_key,
                                            "text": request.text, "subject": request.subject}) as span:
                sent = await deps.sender.send(request)
                span.output = {**sent.as_dict(), "freshness_recheck": freshness}
                span.reasoning = list(sent.reasoning)
                if freshness and freshness["sold"]:
                    span.reasoning.insert(0, f"Re-checked stock right before sending: {', '.join(freshness['sold'])} "
                                             "sold in the meantime, so the stock-free version was sent instead.")
                span.metrics = {"attempts": sent.attempts, "event_to_send_ms": sent.latency_ms}
                span.edge_label = sent.status
            async with tracer.node("schedule", {"sent_status": sent.status, "channel": channel}) as span:
                planned = await plan_followup(
                    db, sent=sent, draft=draft, lead=lead, customer=customer, lead_id=lead_id,
                    customer_id=customer_id, turn_id=tracer.turn_id, channel=channel, action=action)
                span.output = planned
                if planned["created"]:
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
        if trigger == TRIGGER_RESUME and sent is not None and sent.status in ("sent", "duplicate") and not shadow:
            await _notify_team_at_opening(db, lead_id, result)
        if sent is not None and sent.status in ("sent", "duplicate") and not shadow:
            await _notify_team_of_booking(db, lead_id, decision)
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
            "tokens_out": sum(c.get("tokens_out") or 0 for c in calls),
            "cost_usd": round(sum(c.get("cost_usd") or 0 for c in calls), 6),
            "campaign_id": (result.get("campaign") or {}).get("campaign_id"),
            "batched": len(batch),
            "summary_queued": summary_queued,
            "send_check": (sent.compliance or {}).get("outcome") if sent else None,
            "origin": (ctx.compliance or {}).get("origin", {}).get("origin"),
            "review_opened": review,
            "after_hours": (decision.get("after_hours") or {}).get("mode"),
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


async def _visit_followup_schedule(db: DealerScopedDatabase, decision: dict[str, Any], sent: SendOutcome | None, *,
                                   lead_id: str, lead: dict | None, customer: dict | None, customer_id: str,
                                   channel: str, turn_id: str, shadow: bool) -> dict[str, Any] | None:
    """The dated visit follow-up after a 3rd decline (MASTER_PLAN_3 B4 item
    4): scheduled once the decline reply goes out; cancelled once a booking
    exists (nothing left to follow up on). Only when the reply went out."""
    plan = decision.get("visit_plan") or {}
    if shadow or sent is None or sent.status not in ("sent", "failed", "duplicate"):
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
