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
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any

from upsell_agent import clock
from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.graph import build_graph
from upsell_agent.agent.nodes.template_reply import template_draft
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
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
from upsell_agent.scheduler.followups import plan_followup
from upsell_agent.slots.requirements import lead_type_for

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
) -> dict[str, Any]:
    """`turn_id`: the handlers derive it from what triggered the turn, so a
    re-run of the same job (a retry, or the queue re-delivering it) reuses the
    send's idempotency key and can never message the customer twice."""
    settings = deps.config
    db = dealer_scoped_db(dealer_id)
    tracer = TurnTracer(
        sink=deps.sink, dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id,
        trigger=trigger, channel=channel, store_prompts=deps.store_prompts, turn_id=turn_id,
    )
    await tracer.start({"text": inbound_text, "channel": channel, "shadow": shadow})

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
                    span.reasoning = [f"Same message goes to {planned['to_channel']} ({planned['to']}) {when}."]
                    if planned["superseded"]:
                        span.reasoning.append("Replaced this lead's older pending follow-up.")
                    span.edge_label = f"→ {planned['to_channel']} {'now' if planned['due_now'] else 'in 24h'}"
                else:
                    span.reasoning = [f"No follow-up: {planned['reason']}."]

        await _update_lead_state(db, lead_id, trigger, sent, result)

        if result.get("used_template") and not result.get("used_fallback"):
            outcome = "template_reply"
        elif result.get("used_fallback"):
            outcome = "fallback"
        else:
            outcome = action or "unknown"
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
        })
        await db.collection(AI_TURN_LOG_COLLECTION).insert_one(log)
        return log


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


async def _update_lead_state(db: DealerScopedDatabase, lead_id: str | None, trigger: str,
                             sent: SendOutcome | None, result: dict[str, Any]) -> None:
    """Lead status follows the turn (architecture §8.3): qualified when
    nothing is missing, handed off when the customer asked for a person or
    the AI couldn't write a safe reply."""
    if not lead_id:
        return
    decision = result.get("decision") or {}
    fields: dict[str, Any] = {"last_asked_slots": decision.get("slots", []), "last_turn_at": clock.now()}
    if sent is not None:
        fields["last_send_status"] = sent.status
        if sent.status == "sent":
            fields["last_outbound_at"] = clock.now()
            if trigger == "lead_created" and sent.latency_ms is not None:
                fields["first_reply_ms"] = sent.latency_ms
    if decision.get("required_total") is not None:
        fields["required"] = {"filled": decision.get("required_filled"), "total": decision.get("required_total")}
    if result.get("flag_human"):
        fields.update(status="handoff", status_reason="AI couldn't write a safe reply", status_at=clock.now())
    elif decision.get("action") == "handoff":
        why = next((r["why"] for r in decision.get("rules", []) if r["result"] == "fired"), "Customer asked for a person")
        fields.update(status="handoff", status_reason=why, status_at=clock.now())
    elif decision.get("action") == "qualified":
        fields.update(status="qualified", status_reason="All required details collected", status_at=clock.now())
    await db.collection(AI_LEAD_STATE_COLLECTION).update_one(
        {"lead_id": lead_id},
        {"$set": fields, "$setOnInsert": {"lead_id": lead_id, "created_at": clock.now(),
                                          **({} if "status" in fields else {"status": "active"})}},
        upsert=True)
