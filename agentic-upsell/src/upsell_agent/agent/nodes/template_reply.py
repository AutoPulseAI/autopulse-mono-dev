"""The template reply step (pipeline node id `fallback`).

Reached when:
- a new lead's first reply while FIRST_REPLY_MODE=template (straight from
  load_context, no AI);
- Extract or Compose failed or ran out of time / AI calls;
- the guard rejected the AI's draft twice (the lead is also flagged for a
  human);
- the whole turn ran out of time (agent/turn.py builds the same draft).

Templates contain no prices, numbers or promises (agent/templates.py).
"""

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.qualification import LeadType
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.templates import render_continue_reply, render_first_reply
from upsell_agent.observability.trace import NodeSpan


def template_draft(lead_type: LeadType | None, customer_name: str | None, why: str, *,
                   mid_conversation: bool = False, decision: dict | None = None) -> dict:
    """The first-reply template, or (PLAN_4 stream Q) once the conversation has started, the continue template
    built from Decide's plan (agent/templates.render_continue_reply) - never "new or used?" out of the blue."""
    spanish = (decision or {}).get("reply_language") == "Spanish"
    draft = (render_continue_reply(customer_name, decision, first=not mid_conversation)
             if mid_conversation or spanish else render_first_reply(lead_type or LeadType.GENERAL, customer_name))
    draft["why"] = why
    return draft


def mid_conversation(state: AgentState) -> bool:
    """We've already written to this customer (the conversation has at least one reply of ours)."""
    return int(((state.context_pack or {}).get("conversation") or {}).get("turn") or 0) > 0


async def template_reply(state: AgentState, span: NodeSpan, ctx: TurnContext | None = None) -> dict:
    lead_type = state.lead_type or LeadType.GENERAL
    first_reply = state.first_reply_via_template and not state.fallback_reason
    if first_reply:
        why = "First reply to a new lead uses the template (FIRST_REPLY_MODE=template)."
        span.reasoning = [
            f"New {lead_type.value} lead: sending the '{lead_type.value}' template straight away, no AI call.",
            "Set FIRST_REPLY_MODE=ai to have the AI write first replies, with this template as the fallback.",
        ]
        span.edge_label = "template"
    else:
        why = f"Template used because {state.fallback_reason}."
        span.reasoning = [
            f"Using the '{lead_type.value}' template: {state.fallback_reason}.",
            "It contains no prices, numbers or promises, so it is always safe to send.",
        ]
        if state.flag_human:
            span.reasoning.append("The lead is flagged for a human to review.")
        span.edge_label = "fallback template"
    later = not first_reply and mid_conversation(state)
    if later:
        span.reasoning.append("Mid-conversation: the continue template, built from Decide's plan.")
    draft = template_draft(lead_type, state.customer_name, why, mid_conversation=later, decision=state.decision)
    span.output = draft
    return {"draft": draft, "used_template": True, "used_fallback": not first_reply}
