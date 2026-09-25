"""Runs one turn end to end: graph → send → schedule → lead status → turn log.

The graph decides and drafts; this module owns everything with a side effect
on the customer (architecture §7 "The pipeline never sends"). Send is real
(channels/sender.py); Schedule saves the 24h channel switch
(scheduler/followups.py). Both are traced like every other step so the Debug
UI shows the full path.

Limits (architecture §7): the whole turn gets 8s for a new lead's first reply
and 20s otherwise. Running out of time sends the template - never nothing.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from upsell_agent import clock
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.conversation import after_turn, load_conversation
from upsell_agent.agent.graph import build_graph
from upsell_agent.agent.nodes.template_reply import template_draft
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.summary import UPDATE_SUMMARY_JOB
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender, SendOutcome, SendRequest
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
from upsell_agent.scheduler.followups import plan_followup, plan_handoff_check
from upsell_agent.slots.requirements import lead_type_for
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
) -> dict[str, Any]:
    """`turn_id`: the handlers derive it from what triggered the turn, so a
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
            request = SendRequest(
                dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id, turn_id=tracer.turn_id,
                channel=channel, text=reply or "", subject=None if channel == "sms" else draft.get("email_subject"),
                shadow=shadow, event_received_at=event_received_at,
            )
            async with tracer.node("send", {"channel": channel, "idempotency_key": request.idempotency_key,
                                            "text": request.text, "subject": request.subject}) as span:
                sent = await deps.sender.send(request)
                span.output = sent.as_dict()
                span.reasoning = sent.reasoning
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
                                "(SMS waits for the 8:00-20:00 contact window)")
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

        await _update_lead_state(db, lead_id, trigger, sent, result, lead_state=lead_state, channel=channel,
                                 shadow=shadow, turn_id=tracer.turn_id)

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
        })
        await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
        return log


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
