"""Compose (architecture §7): the AI writes the message for the step Decide
chose, as an SMS version and an email version at once (the 24h channel
switch re-sends the other version without another AI call).

Stronger model (MODEL_COMPOSE), 5 seconds per attempt. On a rewrite it is
told what the Guard objected to. Any failure routes the turn to the
template.
"""

from typing import Any

from upsell_agent.agent.context import AiBudgetExceeded, TurnContext
from upsell_agent.agent.llm import compose_agent, run_agent
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.templates import first_name
from upsell_agent.observability.trace import NodeSpan

OUTPUT_TOKENS = 600


def compose_payload(state: AgentState) -> dict[str, Any]:
    decision = state.decision or {}
    profile = state.profile or {}
    return {
        "action": decision.get("action"),
        "asks": [{"label": a["label"], "hint": a["hint"]} for a in decision.get("asks", [])],
        "confirm": decision.get("confirm"),
        "answer_questions": decision.get("answer_questions", []),
        "customer_first_name": first_name(state.customer_name),
        "channel": state.channel,
        "campaign": state.campaign,
        "profile": {s["label"]: s["value"] for s in profile.get("slots", []) if s["state"] in ("filled", "stale")},
        "recent_messages": state.recent_messages[-10:],
        "customer_text": state.inbound_text,
        "attempt": state.retry_count + 1,
        "guard_feedback": (state.guard_result or {}).get("violations", []) if state.retry_count else [],
    }


async def compose(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    model = ctx.settings.model_compose
    payload = compose_payload(state)
    span.metrics = {"model": model}
    try:
        ctx.spend_ai_call()
        result, call = await run_agent(compose_agent(model), model, payload,
                                       timeout_s=ctx.settings.compose_timeout_s, output_tokens_limit=OUTPUT_TOKENS)
    except TimeoutError:
        return _failed(span, f"no answer within {ctx.settings.compose_timeout_s}s")
    except AiBudgetExceeded as exc:
        return _failed(span, str(exc))
    except Exception as exc:  # noqa: BLE001 - any model/provider error sends the template
        return _failed(span, f"{type(exc).__name__}: {exc}")

    draft = {**result.model_dump(), "attempt": payload["attempt"]}
    ctx.model_calls.append({"step": "compose", **call.as_metrics()})
    span.output = draft
    span.metrics = call.as_metrics()
    span.reasoning = [draft["why"]]
    if payload["guard_feedback"]:
        span.reasoning.append("Rewrite after the guard objected to: " + "; ".join(payload["guard_feedback"]))
    if state.campaign:
        span.reasoning.append(f"Replying in the context of the campaign '{state.campaign['name']}'.")
    span.edge_label = f"draft {payload['attempt']}"
    return {"draft": draft}


def _failed(span: NodeSpan, reason: str) -> dict[str, Any]:
    span.output = {"error": reason}
    span.reasoning = [f"Compose failed: {reason}. Sending the template instead."]
    span.edge_label = "failed"
    return {"draft": None, "fallback_reason": f"compose failed: {reason}"}
