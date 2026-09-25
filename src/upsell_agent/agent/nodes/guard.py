"""Guard (architecture §7): nothing the AI wrote is sent until it passes
guardrails/draft_guard.py. One rewrite is allowed; a second failure sends
the safe template and flags the lead for a human."""

from typing import Any

from upsell_agent.agent.context import TurnContext
from upsell_agent.agent.state import AgentState
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.observability.trace import NodeSpan

MAX_REWRITES = 1


async def guard(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    if state.fallback_reason:  # Compose failed: nothing to check
        result = {"passed": False, "checks": {}, "violations": [state.fallback_reason], "next": "fallback"}
        span.output = result
        span.reasoning = [f"No draft ({state.fallback_reason}); using the template."]
        span.edge_label = "fallback"
        return {"guard_result": result}

    customer_texts = [state.inbound_text] + [m["text"] for m in state.recent_messages if m["direction"] == "inbound"]
    known = [s["value"] for s in (state.profile or {}).get("slots", []) if s.get("value") is not None]
    if state.campaign:
        # The dealer wrote the campaign: its name and offer may be repeated.
        known += [state.campaign.get(k) for k in ("name", "goal", "subject", "body")]
    result = check_draft(state.draft, customer_texts=customer_texts, known_values=known)
    will_retry = not result["passed"] and state.retry_count < MAX_REWRITES
    result["next"] = "send" if result["passed"] else ("compose" if will_retry else "fallback")

    span.output = result
    span.reasoning = [f"{'✓' if ok else '✗'} {name.replace('_', ' ')}" for name, ok in result["checks"].items()]
    if result["violations"]:
        span.reasoning.append("Problems: " + "; ".join(result["violations"]))
    if not result["passed"]:
        span.reasoning.append("One rewrite allowed." if will_retry
                              else "Second failure: sending the template and flagging the lead for a human.")
    span.edge_label = "approved" if result["passed"] else ("rewrite" if will_retry else "fallback")

    if will_retry:
        await ctx.tracer.retry("guard", "compose", reason="; ".join(result["violations"]),
                               attempt=state.retry_count + 1)
        return {"guard_result": result, "retry_count": state.retry_count + 1}
    if not result["passed"]:
        return {"guard_result": result, "fallback_reason": "guard rejected the draft twice", "flag_human": True}
    return {"guard_result": result}
